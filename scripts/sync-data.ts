#!/usr/bin/env node
/**
 * CLI script to manually sync JSON data from Firebase
 * Usage: npm run sync:data
 */

import { syncAllPublicJson } from '../src/server/dataSync.js';

async function main() {
  console.log('\n🔄 Starting manual data synchronization...\n');
  
  try {
    const result = await syncAllPublicJson();
    
    console.log('\n📋 Synchronization Results:');
    result.results.forEach(r => {
      const status = r.success ? '✅' : '❌';
      console.log(`  ${status} ${r.file}: ${r.message}`);
      if (r.error) {
        console.log(`     Error: ${r.error}`);
      }
    });
    
    if (result.success) {
      console.log('\n✅ All data synchronized successfully!\n');
      process.exit(0);
    } else {
      console.log('\n⚠️ Synchronization completed with errors\n');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error during synchronization:');
    console.error(error.message);
    console.log();
    process.exit(1);
  }
}

main();
