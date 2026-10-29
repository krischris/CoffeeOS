/** Versioned portable schema. Never derive database/storage identity from this contract. */
export const backupTables = ['beans', 'brew_sessions'] as const;
export type BackupTable = typeof backupTables[number];
// Collection size is user-managed; retain the small manifest bound for validation.
export const backupLimits = { archive: Infinity, expanded: Infinity, manifest: 64 * 1024 } as const;
export interface BackupColumn { name: string; logical_type: string; nullable: boolean; unit?: string }
const column = (name: string, logical_type: string, nullable = true, unit?: string): BackupColumn =>
  ({ name, logical_type, nullable, ...(unit ? { unit } : {}) });
export const backupColumns: Record<BackupTable, BackupColumn[]> = {
  beans: [column('id', 'string', false), column('name', 'string', false), column('roast_date', 'date'),
    column('freeze_date', 'date'), column('created_at', 'timestamp_us_utc', false), column('photo_jpeg', 'jpeg_data_url')],
  brew_sessions: [column('id', 'string', false), column('bean_id', 'string', false), column('brewed_at', 'timestamp_us_utc', false),
    column('dose_g', 'binary64', true, 'g'), column('water_g', 'binary64', true, 'g'), column('time_str', 'string'),
    column('temp_c', 'binary64', true, 'degC'), column('grind_um', 'binary64', true, 'um'), column('comment', 'string'),
    column('yield_g', 'binary64', true, 'g'), column('tds_pct', 'binary64', true, 'percentage_points'),
    column('extraction_pct', 'binary64', true, 'percentage_points')],
};
/** Schema 2 is additive; schema 1 remains the unchanged historical contract. */
export const webpBackupColumns: Record<BackupTable, BackupColumn[]> = {
  ...backupColumns, beans: [...backupColumns.beans, column('photo_webp', 'webp_data_url')],
};
export const sessionForeignKeys = [{ columns: ['bean_id'], references: { table: 'beans', columns: ['id'] } }];
