<?php

declare(strict_types=1);

function listDirectory(string $dir): string
{
    return (string) shell_exec('ls -la ' . $dir);
}

function archive(string $dir): void
{
    exec('tar czf backup.tgz ' . $dir);
    $pipes = [];
    proc_open('git log ' . $dir, [], $pipes);
}

function diskUsage(): string
{
    return (string) `du -sh .`;
}
