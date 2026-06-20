-- Realtime for thoughts (cross-tab / cross-device capture list).
-- Idempotent: query-mode deploy re-runs all migration files without schema_migrations tracking.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'trellis'
      and tablename = 'thoughts'
  ) then
    alter publication supabase_realtime add table trellis.thoughts;
  end if;
end $$;
