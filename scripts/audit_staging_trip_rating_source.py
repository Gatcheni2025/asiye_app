#!/usr/bin/env python3
"""Read-only immutable source proof for the existing trip-action endpoint."""
try:
    from .audit_staging_admin_function_source import main
except ImportError:
    from audit_staging_admin_function_source import main

if __name__ == '__main__':
    raise SystemExit(main('scripts/staging_trip_rating_functions.json',
                         'STAGING_TRIP_RATING_SOURCE', full_review_scope=True))
