<?php

declare(strict_types=1);

function findGuest(string $email): mixed
{
    global $wpdb;

    return $wpdb->get_row($wpdb->prepare('SELECT * FROM %i WHERE email = %s', $wpdb->prefix . 'guests', $email));
}

function countGuests(): int
{
    global $wpdb;

    return (int) $wpdb->get_var('SELECT 1');
}
