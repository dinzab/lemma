---
name: testing-usage-limits
description: Test the token-based usage limits feature end-to-end. Use when verifying settings page, quota enforcement, or usage tracking changes.
---

# Testing Usage Limits

## Prerequisites

- Docker-compose dev stack running (`docker compose -f docker-compose.dev.yml up --build -d`)
- Migration `004_create_usage_events.sql` applied to Supabase (creates `plans`, `user_plans`, `usage_events` tables)
- Test user created via Supabase admin API

## Devin Secrets Needed

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` — for admin API calls (create test users)
- Database password — for direct psql access to manipulate plan limits

## Supabase Connectivity

Direct connections to `db.<project>.supabase.co` may fail due to IPv6 unreachability from the Devin VM. Use the Supabase connection pooler instead:

```
postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

The correct pooler region for this project is `eu-west-1`. Other regions will return "Tenant or user not found".

## Creating Test Users

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "test-password", "email_confirm": true}'
```

## Testing Quota Enforcement

To trigger quota errors without waiting for real token consumption:

1. Lower plan limits temporarily:
   ```sql
   UPDATE plans SET window_token_limit = 1 WHERE id = 'free';
   ```

2. Insert a fake usage event:
   ```sql
   INSERT INTO usage_events (user_id, tokens_used) VALUES ('<user-id>', 100);
   ```

3. Send a chat message — should get blocked with orange quota banner

4. **Always restore limits after testing:**
   ```sql
   UPDATE plans SET window_token_limit = 20000 WHERE id = 'free';
   DELETE FROM usage_events WHERE user_id = '<user-id>';
   ```

## Key Test Areas

### Settings Page (`/settings`)
- Plan card: crown icon, plan label, limits summary (e.g., "100.0K tokens/week · 20.0K per 5h")
- Usage bars: Weekly Allowance (Zap icon) and N-Hour Window (Clock icon)
- Bar colors: green <80%, orange 80-99%, red ≥100%
- Refresh countdowns: "Refreshes in Xd Yh" / "Xh Ym"
- Explanation section: 3 bullets about how limits work
- Upgrade button: present but disabled

### Quota Error Banner (chat page)
- Orange background banner with bucket-specific message
- "Weekly token limit reached" vs "Token limit reached for this window"
- Countdown to reset
- "View usage" link → navigates to /settings
- "Dismiss" button

### Known Issues
- Dismissing the quota banner may expose the raw JSON error in a red generic error area. This happens because `clearQuotaError()` only clears the `quotaError` state but not the SDK's underlying `error`. Check if this has been fixed.

## API Endpoint

- `GET /api/usage` — returns usage snapshot (proxies to backend `GET /usage`)
- Response shape:
  ```json
  {
    "plan": { "id": "free", "label": "Free", "weeklyTokenLimit": 100000, "windowTokenLimit": 20000, "windowHours": 5 },
    "weekly": { "used": 0, "limit": 100000, "resetsAt": "<ISO>" },
    "window": { "used": 0, "limit": 20000, "windowHours": 5, "resetsAt": "<ISO>" }
  }
  ```

## Default Plan Limits

- Weekly: 100,000 tokens (rolling 7-day window)
- Window: 20,000 tokens (rolling 5-hour window)
- Plan ID: `free`
