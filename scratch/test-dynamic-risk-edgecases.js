const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(process.cwd(), 'scripts/phase51-15m-live-runner.js'), 'utf8');

const calcMatch = code.match(/function calculateDynamicRiskPlan\([\s\S]*?^}/m);
if (!calcMatch) throw new Error("Could not find calculateDynamicRiskPlan in runner");

const safeNum = new Function('v', 'digits = 8', 'return Number(Number(v).toFixed(digits));');
const TAKER_FEE = 0.001;
const TP_PCT = 0.007;
const SL_PCT = 0.007;

const calculateRiskBody = calcMatch[0]
    .replace('function calculateDynamicRiskPlan(dir, entryPrice, entrySnapshot, ts) {', '')
    .replace(/}$/, '');

const calculateDynamicRiskPlan = new Function('dir', 'entryPrice', 'entrySnapshot', 'ts', 'TAKER_FEE', 'TP_PCT', 'SL_PCT', 'safeNum', calculateRiskBody);

function runTest(name, dir, expectedMovePct, vol, entryPrice) {
    console.log(`\n--- TEST: ${name} ---`);
    console.log(`Inputs: Dir=${dir}, ExpectedMove=${expectedMovePct}%, Vol=${vol}`);
    
    const entrySnapshot = {
        direction: dir,
        contextFeatures: { volatility: vol },
        frozenPredictions: {
            300: { expectedMovePct: expectedMovePct }
        }
    };
    
    const ts = Date.now();
    const result = calculateDynamicRiskPlan(dir, entryPrice, entrySnapshot, ts, TAKER_FEE, TP_PCT, SL_PCT, safeNum);
    
    const tpDec = result.tpPct;
    const slDec = result.slPct;
    
    console.log(`TP %: ${(tpDec * 100).toFixed(3)}% | SL %: ${(slDec * 100).toFixed(3)}% | RR: ${result.riskRewardRatio}`);
    
    let pass = true;
    
    // Constraints checks
    if (tpDec < 0.003 || tpDec > 0.020) {
        console.error(`FAIL: TP out of bounds: ${tpDec}`);
        pass = false;
    }
    if (slDec < 0.003 || slDec > 0.015) {
        console.error(`FAIL: SL out of bounds: ${slDec}`);
        pass = false;
    }
    if (tpDec / slDec < 0.999) { // Using 0.999 to account for float precision
        console.error(`FAIL: RR < 1.0: ${tpDec / slDec}`);
        pass = false;
    }
    if (tpDec < TAKER_FEE * 2.5) {
        console.error(`FAIL: TP < Fee floor: ${tpDec}`);
        pass = false;
    }
    
    // Directional price checks
    if (dir === 'LONG') {
        if (!(result.slPrice < entryPrice && entryPrice < result.tpPrice)) {
            console.error(`FAIL: LONG Price ordering invalid. SL:${result.slPrice} Entry:${entryPrice} TP:${result.tpPrice}`);
            pass = false;
        }
    } else {
        if (!(result.tpPrice < entryPrice && entryPrice < result.slPrice)) {
            console.error(`FAIL: SHORT Price ordering invalid. TP:${result.tpPrice} Entry:${entryPrice} SL:${result.slPrice}`);
            pass = false;
        }
    }
    
    if (pass) console.log(`STATUS: PASS`);
}

// 1. Low vol / small move LONG
runTest('Low vol / small move LONG', 'LONG', 0.10, 0.0001, 2500);

// 2. Low vol / small move SHORT
runTest('Low vol / small move SHORT', 'SHORT', 0.10, 0.0001, 2500);

// 3. Normal move LONG
runTest('Normal move LONG', 'LONG', 1.00, 0.005, 2500);

// 4. Normal move SHORT
runTest('Normal move SHORT', 'SHORT', 1.00, 0.005, 2500);

// 5. High vol / large move LONG
runTest('High vol / large move LONG', 'LONG', 5.00, 0.05, 2500);

// 6. High vol / large move SHORT
runTest('High vol / large move SHORT', 'SHORT', 5.00, 0.05, 2500);

// 7. Zero LONG
runTest('Zero LONG', 'LONG', 0, 0, 2500);

// 8. Zero SHORT
runTest('Zero SHORT', 'SHORT', 0, 0, 2500);
