-- Keep updated_at fresh on units and requisitions.
create function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_units_updated_at
  before update on units for each row execute procedure set_updated_at();

create trigger trg_requisitions_updated_at
  before update on requisitions for each row execute procedure set_updated_at();
