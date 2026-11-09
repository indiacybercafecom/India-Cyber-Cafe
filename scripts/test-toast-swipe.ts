import fs from 'fs';
import path from 'path';

async function runToastSwipeTests() {
  console.log('🧪 Running Toast Swipe-to-Dismiss Feature Tests...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  }

  // 1. Inspect Toast.tsx content
  const toastFileContent = fs.readFileSync(path.join(process.cwd(), 'src/components/Toast.tsx'), 'utf-8');

  // Check 1: drag="x" and touch-pan-y
  assert(
    toastFileContent.includes('drag="x"') && toastFileContent.includes('touch-pan-y'),
    'Test 1: ToastItem implements drag="x" and touch-pan-y for smooth vertical scrolling'
  );

  // Check 2: dragConstraints and dragElastic
  assert(
    toastFileContent.includes('dragConstraints={{ left: 0, right: 0 }}') && toastFileContent.includes('dragElastic='),
    'Test 2: ToastItem enforces return bounds via dragConstraints and dragElastic'
  );

  // Check 3: onDragEnd handler
  assert(
    toastFileContent.includes('onDragEnd={handleDragEnd}'),
    'Test 3: ToastItem attaches onDragEnd handler'
  );

  // Check 4: Both horizontal directions supported
  assert(
    toastFileContent.includes('offset.x > thresholdDistance') &&
    toastFileContent.includes('offset.x < -thresholdDistance') &&
    toastFileContent.includes('velocity.x > thresholdVelocity') &&
    toastFileContent.includes('velocity.x < -thresholdVelocity'),
    'Test 4: Swipe detector detects both swipe left and swipe right with distance & velocity thresholds'
  );

  // Check 5: Individual dismissal with direction variants
  assert(
    toastFileContent.includes('x: 420') && toastFileContent.includes('x: -420'),
    'Test 5: Exit variants slide out completely left (-420) or right (420)'
  );

  // Check 6: Layout animation enabled for remaining toasts
  assert(
    toastFileContent.includes('layout'),
    'Test 6: motion.div includes layout prop for smooth remaining toast repositioning'
  );

  // Check 7: Cursor and interaction cues
  assert(
    toastFileContent.includes('cursor-grab') && toastFileContent.includes('active:cursor-grabbing'),
    'Test 7: Toast provides desktop grab/grabbing cursor affordances'
  );

  // Check 8: Preserves 3200ms automatic timer
  assert(
    toastFileContent.includes('3200'),
    'Test 8: Preserves 3200ms automatic dismissal timeout'
  );

  // Check 9: Preserves error sanitization
  assert(
    toastFileContent.includes('getFriendlyErrorMessage'),
    'Test 9: Preserves global error sanitization'
  );

  // Check 10: Preserves deduplication
  assert(
    toastFileContent.includes('recentToasts'),
    'Test 10: Preserves recent toasts deduplication cache'
  );

  console.log(`\n========================================`);
  console.log(`Results: ${passed} / ${total} tests passed.`);
  console.log(`========================================\n`);

  if (passed < total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runToastSwipeTests();
