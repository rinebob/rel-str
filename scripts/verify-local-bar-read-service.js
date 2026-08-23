#!/usr/bin/env node
/**
 * Verification script for Task #170 — Local bar-read service.
 *
 * Verifies that LocalBarReadService exists with the required methods
 * and that the unit tests pass.
 *
 * Usage:
 *   node scripts/verify-local-bar-read-service.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT, 'src', 'app', 'core', 'services', 'local-bar-read.service.ts');
const SPEC_PATH = path.join(ROOT, 'src', 'app', 'core', 'services', 'local-bar-read.service.spec.ts');

let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passes++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + detail : ''}`);
    failures++;
  }
}

console.log('=== Task #170 Verification: Local bar-read service ===\n');

// 1. File existence
console.log('1. File checks');
check('local-bar-read.service.ts exists', fs.existsSync(SERVICE_PATH));
check('local-bar-read.service.spec.ts exists', fs.existsSync(SPEC_PATH));

// 2. Service methods
console.log('\n2. Service method checks');
const serviceContent = fs.readFileSync(SERVICE_PATH, 'utf8');
check('getDailyBars$ method exists', serviceContent.includes('getDailyBars$'));
check('getWeeklyBars$ method exists', serviceContent.includes('getWeeklyBars$'));
check('getMonthlyBars$ method exists', serviceContent.includes('getMonthlyBars$'));
check('getRecentDailyBars$ method exists', serviceContent.includes('getRecentDailyBars$'));
check('OhlcBar interface exported', serviceContent.includes('export interface OhlcBar'));
check('uses Collection.SYMBOL_DATA', serviceContent.includes('Collection.SYMBOL_DATA'));
check('@Injectable decorator', serviceContent.includes('@Injectable'));

// 3. Test coverage
console.log('\n3. Test coverage checks');
const specContent = fs.readFileSync(SPEC_PATH, 'utf8');
check('tests for getDailyBars$', specContent.includes("describe('getDailyBars$'"));
check('tests for getWeeklyBars$', specContent.includes("describe('getWeeklyBars$'"));
check('tests for getMonthlyBars$', specContent.includes("describe('getMonthlyBars$'"));
check('tests for getRecentDailyBars$', specContent.includes("describe('getRecentDailyBars$'"));
check('year boundary test', specContent.includes('year boundary'));
check('error handling tests', specContent.includes("describe('error handling'"));
check('empty symbol edge case', specContent.includes('empty symbol'));

// 4. Run tests
console.log('\n4. Run unit tests');
try {
  execSync('npx jest --config jest.config.js --testPathPatterns "local-bar-read" --no-coverage', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    stdio: 'pipe',
  });
  check('unit tests pass', true);
} catch (e) {
  check('unit tests pass', false, e.stdout || e.message);
}

// 5. Summary
console.log(`\n=== Summary: ${passes} passed, ${failures} failed ===`);
process.exit(failures > 0 ? 1 : 0);
