"""Independent ZIP/Parquet verification; run with uv run python (PyArrow required)."""
from datetime import datetime
from io import BytesIO
from pathlib import Path
import hashlib
import json
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED
import pyarrow as pa
import pyarrow.parquet as pq

path = Path('docs/fixtures/example-v1.coffeeos')
with ZipFile(path) as archive:
    assert sorted(archive.namelist()) == ['beans.parquet', 'brew_sessions.parquet', 'manifest.json']
    assert all(info.compress_type == ZIP_STORED for info in archive.infolist())
    entries = {name: archive.read(name) for name in archive.namelist()}
manifest = json.loads(entries['manifest.json'])
tables = {}
for spec in manifest['tables']:
    raw = entries[spec['path']]
    assert len(raw) == spec['byte_length']
    assert hashlib.sha256(raw).hexdigest() == spec['sha256']
    file = pq.ParquetFile(BytesIO(raw))
    table = file.read()
    assert table.num_rows == spec['row_count']
    print(spec['name'], file.schema)
    tables[spec['name']] = {row['id']: row for row in table.to_pylist()}
    for field in table.schema:
        assert field.nullable
        if field.name in ['created_at', 'brewed_at']:
            assert field.type == pa.timestamp('us')
        elif field.name.endswith('_date'):
            assert field.type == pa.date32()
        elif field.name in ['dose_g', 'water_g', 'temp_c', 'grind_um', 'yield_g', 'tds_pct', 'extraction_pct']:
            assert field.type == pa.float64()
        else:
            assert field.type == pa.string()
beans, sessions = tables['beans'], tables['brew_sessions']
assert len(beans) == 3 and len(sessions) == 2
assert beans['portable']['created_at'] == datetime(2026, 10, 25, 10, 20, 30, 123456)
assert beans['no-sessions']['created_at'] == datetime(2026, 9, 1, 0, 0, 0, 1)
assert beans['portable']['name'] == '咖啡 ☕'
assert beans['portable']['photo_jpeg'] is None
photo = next(b['photo_jpeg'] for b in beans.values() if b['name'] == 'Photo')
assert photo.startswith('data:image/jpeg;base64,/9j/')
precise = sessions['precise']
assert precise['brewed_at'] == datetime(2026, 10, 25, 10, 21, 30, 654321)
assert precise['dose_g'] == 18.123456789012345
assert precise['tds_pct'] == 1.4300000000000002
assert precise['extraction_pct'] == 19.999999999999996
assert precise['water_g'] == 0 and precise['temp_c'] is None
assert precise['time_str'] == '' and sessions['sparse']['time_str'] is None
assert precise['comment'] == 'Line 1\n行 2 ☕' and sessions['sparse']['comment'] == ''
Path('.cache/backups').mkdir(parents=True, exist_ok=True)
with ZipFile('.cache/backups/python-deflate.zip', 'w', compression=ZIP_DEFLATED) as archive:
    for name, raw in entries.items():
        archive.writestr(name, raw)
print('PASS independent Python ZIP/PyArrow counts, SHA256, physical/logical schemas, microseconds, binary64, Unicode, nulls, and photos; wrote DEFLATE repack')
roundtrip_path = Path('.cache/backups/roundtrip.coffeeos')
if roundtrip_path.exists():
    import struct
    with ZipFile(roundtrip_path) as restored:
        for name in ['beans', 'brew_sessions']:
            rows = pq.read_table(BytesIO(restored.read(name + '.parquet'))).to_pylist()
            original = tables[name]
            assert set(original) == {row['id'] for row in rows}
            for row in rows:
                for field, value in row.items():
                    expected = original[row['id']][field]
                    if isinstance(value, float):
                        assert struct.pack('>d', value) == struct.pack('>d', expected), (name, row['id'], field)
                    else:
                        assert value == expected, (name, row['id'], field, value, expected)
    print('PASS independent exact restored archive comparison for every field, microsecond timestamp and binary64 bit pattern')


# Valid ZIP/checksums around invalid Parquet values exercise staging, not ZIP rejection.
from copy import deepcopy
invalid_dir = Path('.cache/backups/invalid')
invalid_dir.mkdir(parents=True, exist_ok=True)
def invalid_archive(label, table_name, mutate):
    files = dict(entries)
    table = pq.read_table(BytesIO(files[table_name + '.parquet']))
    table = mutate(table)
    output = BytesIO()
    pq.write_table(table, output)
    raw = output.getvalue()
    files[table_name + '.parquet'] = raw
    info = deepcopy(manifest)
    spec = next(t for t in info['tables'] if t['name'] == table_name)
    spec.update(byte_length=len(raw), row_count=table.num_rows, sha256=hashlib.sha256(raw).hexdigest())
    files['manifest.json'] = json.dumps(info, ensure_ascii=False).encode('utf-8')
    with ZipFile(invalid_dir / (label + '.coffeeos'), 'w', compression=ZIP_STORED) as z:
        for name, data in files.items():
            z.writestr(name, data)
def replace_first(table, name, value):
    values = table[name].to_pylist()
    values[0] = value
    return table.set_column(table.schema.get_field_index(name), table.schema.field(name), pa.array(values, type=table.schema.field(name).type))
invalid_archive('null-id', 'beans', lambda t: replace_first(t, 'id', None))
invalid_archive('blank-id', 'beans', lambda t: replace_first(t, 'id', '  '))
invalid_archive('blank-name', 'beans', lambda t: replace_first(t, 'name', '\t '))
invalid_archive('duplicate-id', 'beans', lambda t: pa.concat_tables([t, t.slice(0, 1)]))
invalid_archive('null-time', 'brew_sessions', lambda t: replace_first(t, 'brewed_at', None))
invalid_archive('nan', 'brew_sessions', lambda t: replace_first(t, 'dose_g', float('nan')))
invalid_archive('infinity', 'brew_sessions', lambda t: replace_first(t, 'water_g', float('inf')))
invalid_archive('bad-photo', 'beans', lambda t: replace_first(t, 'photo_jpeg', 'data:image/jpeg;base64,/9j/aaaa'))
invalid_archive('wrong-actual-type', 'brew_sessions', lambda t: t.set_column(t.schema.get_field_index('dose_g'), 'dose_g', t['dose_g'].cast(pa.float32())))
invalid_archive('year-10000', 'brew_sessions', lambda t: t.set_column(t.schema.get_field_index('brewed_at'), 'brewed_at', pa.array([253402300800000000] + [0] * (t.num_rows - 1), type=pa.timestamp('us'))))
print('Generated 10 independently written invalid Parquet archives for browser staging checks')

