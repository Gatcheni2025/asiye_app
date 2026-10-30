#!/usr/bin/env python3
"""Read-only immutable source check for the supported vehicle policy rollout."""
try:
    from .audit_staging_admin_function_source import main
except ImportError:
    from audit_staging_admin_function_source import main

if __name__ == '__main__':
    raise SystemExit(main('scripts/staging_vehicle_eligibility_functions.json',
                         'STAGING_VEHICLE_ELIGIBILITY_FUNCTION_SOURCE', include_selected_in_scope=True))
