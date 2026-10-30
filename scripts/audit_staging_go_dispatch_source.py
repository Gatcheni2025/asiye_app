#!/usr/bin/env python3
"""Read-only immutable source check for the two corrected Go dispatch callers."""
try:
    from .audit_staging_admin_function_source import main
except ImportError:
    from audit_staging_admin_function_source import main

if __name__ == '__main__':
    raise SystemExit(main('scripts/go_dispatch_staging_functions.json', 'STAGING_GO_DISPATCH_FUNCTION_SOURCE'))
