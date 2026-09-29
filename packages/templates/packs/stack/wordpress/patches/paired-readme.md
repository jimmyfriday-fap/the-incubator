1. Put the application in `app/` (`git clone <app repository> app`), then run `composer install --working-dir app` and `composer install`.
2. `node scripts/check.mjs quick` runs the guards, Psalm and the unit and scenario suites against `app/src`.
