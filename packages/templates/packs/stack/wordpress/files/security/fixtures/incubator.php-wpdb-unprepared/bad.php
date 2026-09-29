<?php

declare(strict_types=1);

function findGuest(string $email): mixed
{
    global $wpdb;

    return $wpdb->get_row("SELECT * FROM {$wpdb->prefix}guests WHERE email = '$email'");
}

function deleteGuest(string $id): void
{
    global $wpdb;
    $wpdb->query('DELETE FROM ' . $wpdb->prefix . 'guests WHERE id = ' . $id);
}
