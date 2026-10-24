#!/usr/bin/env python3
"""Read-only exact immutable source check before publishing staging Card/test UI."""
try:
    from .audit_staging_admin_function_source import main
except ImportError:
    from audit_staging_admin_function_source import main

if __name__ == '__main__':
    raise SystemExit(main('scripts/staging_card_test_functions.json',
                         'STAGING_CARD_TEST_FUNCTION_SOURCE', include_selected_in_scope=True))
