<?php

// Formatter (the `format` step checks, `composer format` fixes): PSR-12 for every tracked PHP file.

declare(strict_types=1);

$finder = (new PhpCsFixer\Finder())
    ->in(__DIR__)
    ->exclude(['app', 'node_modules', 'security/fixtures', 'vendor'])
    ->ignoreVCSIgnored(true);

return (new PhpCsFixer\Config())
    ->setRiskyAllowed(false)
    ->setRules([
        '@PSR12' => true,
        'array_syntax' => ['syntax' => 'short'],
        'no_unused_imports' => true,
        'single_quote' => true,
        'trailing_comma_in_multiline' => ['elements' => ['arrays', 'arguments', 'parameters']],
    ])
    ->setCacheFile('.reports/php-cs-fixer.cache')
    ->setFinder($finder);
