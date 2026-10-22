-- "Owner" role: everything an admin can do, plus adding/removing users
-- (Settings page, via the manage-users Edge Function). Its own migration
-- because a new enum value can't be used in the transaction that adds it -
-- see 20261022150100_owner_role_access.sql.
alter type user_role add value if not exists 'owner';
