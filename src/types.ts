export interface Bean {
  id: string;
  name: string;
  roast_date: string | null;
  freeze_date: string | null;
  created_at: string;
  photo_jpeg?: string | null;
}

export interface BrewSession {
  id: string;
  bean_id: string;
  bean_name?: string;
  brewed_at: string;
  dose_g: number | null;
  water_g: number | null;
  time_str: string | null;
  temp_c: number | null;
  grind_um: number | null;
  comment: string | null;
  yield_g: number | null;
  tds_pct: number | null;
  extraction_pct: number | null;
}
