<?php

declare(strict_types=1);

function compute(string $expression): mixed
{
    return eval('return ' . $expression . ';');
}
