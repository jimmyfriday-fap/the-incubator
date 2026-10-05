Scanned 19 of 19 files; nothing skipped.

- Note: 1 go_router routes use a non-literal path and are not listed.

# Repository scan

## Stack

Dart/Flutter (not a supported stack: canonical-pattern files are unavailable): pubspec.yaml

## Entry points

| File | Kind | Note |
| --- | --- | --- |
| cli/bin/club.dart | conventional | Dart entry point |
| lib/main.dart | conventional | Dart entry point |

## Modules

| Module | Files | Languages |
| --- | --- | --- |
| cli/bin | 1 | Dart |
| cli/lib | 1 | Dart |
| cli/lib/src/commands | 2 | Dart |
| cli/test | 1 | Dart |
| lib | 1 | Dart |
| lib/features/admin | 1 | Dart |
| lib/features/auth | 1 | Dart |
| lib/features/events | 2 | Dart |
| lib/models | 1 | Dart |
| lib/providers | 1 | Dart |
| lib/router | 1 | Dart |
| test | 2 | Dart |

## Module dependencies

| From | To | Imports |
| --- | --- | --- |
| cli/bin | cli/lib | 1 |
| cli/lib | cli/lib/src/commands | 1 |
| lib | lib/router | 1 |
| lib/features/events | lib/models | 1 |
| lib/features/events | lib/providers | 1 |
| lib/providers | lib/models | 1 |
| lib/router | lib/features/admin | 1 |
| lib/router | lib/features/auth | 1 |
| lib/router | lib/features/events | 2 |

## Dependencies

| Manifest | Manager | Runtime | Dev |
| --- | --- | --- | --- |
| cli/pubspec.yaml | pub | 1 | 1 |
| pubspec.yaml | pub | 5 | 2 |

## Public routes

| Method | Path | File | Framework |
| --- | --- | --- | --- |
| ROUTE | /login | lib/features/auth/login_screen.dart | go_router |
| ROUTE | /events/:eventId | lib/features/events/event_screen.dart | go_router |
| ROUTE | / | lib/features/events/events_screen.dart | go_router |

## Screens

| Route | Screen | File | Area |
| --- | --- | --- | --- |
| (no route found) | AdminDashboard | lib/features/admin/admin_dashboard.dart | admin |
| (no route found) | ReportsPage | lib/features/admin/admin_dashboard.dart | admin |
| /login | LoginScreen | lib/features/auth/login_screen.dart | auth |
| /events/:eventId | EventScreen | lib/features/events/event_screen.dart | events |
| / | EventsScreen | lib/features/events/events_screen.dart | events |

## Roles

| Name | Values | File | Kind |
| --- | --- | --- | --- |
| UserRole | admin, organizer, member | lib/models/profile.dart | dart-enum |
| user_role | admin, organizer, member | supabase/migrations/001_init.sql | sql-enum |

## Commands

| Name | File | Kind |
| --- | --- | --- |
| list | cli/lib/src/commands/events_commands.dart | args |
| show | cli/lib/src/commands/events_commands.dart | args |

## Data model

| Name | File | Kind |
| --- | --- | --- |
| currentRoleProvider | lib/providers/events_provider.dart | riverpod |
| eventsProvider | lib/providers/events_provider.dart | riverpod |
| events | supabase/migrations/001_init.sql | sql-table |
| profiles | supabase/migrations/001_init.sql | sql-table |

## Tests

Runners: flutter_test, dart_test. Test files: 2; test cases (approximate): 4.
Layout: cli/test, test.
Coverage signals: none detected.

## CI and deploy

_None detected._

Deploy class: not detected.

## Conventions

- Lint: flutter_lints
- Format: dart format
- Type checking: dart analyzer (strict)
- Git hooks: none detected
- Source file naming: snake_case

## Inventory

| Language | Files |
| --- | --- |
| Dart | 15 |
| YAML | 3 |
| SQL | 1 |

| Top-level directory | Files |
| --- | --- |
| lib | 8 |
| cli | 6 |
| . | 2 |
| test | 2 |
| supabase | 1 |

| Largest source files | Characters |
| --- | --- |
| lib/router/app_router.dart | 870 |
| lib/features/events/events_screen.dart | 503 |
| lib/features/events/event_screen.dart | 451 |
| lib/features/admin/admin_dashboard.dart | 358 |
| lib/providers/events_provider.dart | 301 |
| cli/lib/src/commands/events_commands.dart | 278 |
| test/events_test.dart | 268 |
| lib/main.dart | 245 |
| lib/features/auth/login_screen.dart | 197 |
| test/router_test.dart | 193 |
