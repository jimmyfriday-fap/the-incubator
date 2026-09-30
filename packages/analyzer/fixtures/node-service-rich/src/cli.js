#!/usr/bin/env node
import { Command } from 'commander';
import { pool } from './db/pool.js';

const program = new Command('parcel-desk');
program.command('seed').action(async () => pool.query('insert into users(name) values ($1)', ['demo']));
program.command('migrate').action(() => console.log('run migrations/'));
program.parse();
