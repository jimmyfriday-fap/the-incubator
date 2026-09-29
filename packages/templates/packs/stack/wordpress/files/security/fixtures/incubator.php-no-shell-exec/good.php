<?php

declare(strict_types=1);

function gitLog(string $dir): void
{
    $pipes = [];
    $process = proc_open(['git', 'log', '--', $dir], [1 => ['pipe', 'w']], $pipes);
    if (is_resource($process)) {
        proc_close($process);
    }
}
