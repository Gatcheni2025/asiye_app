#!/usr/bin/env python3
"""Read-only proof of the three passenger-confirmed trip-ending endpoints."""
try:
    from .audit_staging_admin_function_source import main
except ImportError:
    from audit_staging_admin_function_source import main

if __name__ == '__main__':
    raise SystemExit(main('scripts/early_trip_end_functions.json',
                         'STAGING_EARLY_TRIP_END_SOURCE', full_review_scope=True))
