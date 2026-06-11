alter table trellis.profiles
drop constraint if exists profiles_subscription_tier_check;

alter table trellis.profiles
add constraint profiles_subscription_tier_check
check (subscription_tier in ('trial', 'byok', 'pro'));
