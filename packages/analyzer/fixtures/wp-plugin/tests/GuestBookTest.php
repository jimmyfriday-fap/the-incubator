<?php

use PHPUnit\Framework\TestCase;

final class GuestBookTest extends TestCase {
	public function test_entries_start_empty(): void {
		$this->assertSame(array(), ( new Guest_Book() )->entries());
	}
}
