const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('entry-analytics.json'));

let totalCheckpoints = 0;
let errors = {
    10: [], 30: [], 60: [], 120: [], 180: [], 300: [], 600: [], 900: []
};

for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
    const trades = data.completedAnalytics || [];
    
    for (const t of trades) {
        if (!t.checkpoints) continue;
        
        const dir = t.direction;
        const entryPrice = t.entryPrice;
        if (!dir || !entryPrice) continue;
        
        for (const [keyMs, cp] of Object.entries(t.checkpoints)) {
            const T_sec = parseInt(keyMs) / 1000;
            const T_min = T_sec / 60;
            
            if (!cp.price) continue; // no raw market price
            
            const microEdgePct = cp.microEdgePct || 0;
            const momentum1sPct = cp.momentum1sPct || 0;
            
            let ret5 = 0, acceleration = 0, ret15 = 0, histEdge = 0;
            
            // Try to pull context features from the first sample which captures entry state
            if (t.samples && t.samples.length > 0) {
                const s0 = t.samples[0];
                if (s0.contextFeatures) {
                    ret5 = s0.contextFeatures.ret5 || 0;
                    acceleration = s0.contextFeatures.acceleration || 0;
                    ret15 = s0.contextFeatures.ret15 || 0;
                }
                if (s0.historical) {
                    histEdge = s0.historical.directionEdge || 0;
                }
            } else if (cp.contextFeatures) {
                ret5 = cp.contextFeatures.ret5 || 0;
                acceleration = cp.contextFeatures.acceleration || 0;
                ret15 = cp.contextFeatures.ret15 || 0;
            }
            if (cp.historical) histEdge = cp.historical.directionEdge || histEdge;
            
            // Normalize inputs
            const norm_microEdge = (dir === 'LONG') ? microEdgePct : -microEdgePct;
            const norm_mom1s = (dir === 'LONG') ? momentum1sPct : -momentum1sPct;
            const norm_ret5 = (dir === 'LONG') ? ret5 : -ret5;
            const norm_accel = (dir === 'LONG') ? acceleration : -acceleration;
            const norm_ret15 = (dir === 'LONG') ? ret15 : -ret15;
            const norm_histEdge = histEdge; // already directional in the runner

            let expectedMovePct = 0;
            
            // Determine expected move based on horizon
            if (T_sec <= 30) {
                // Ultra-short: kinematic decay
                // Expected Move % = norm_microEdge + (norm_mom1s * Math.sqrt(T_sec))
                expectedMovePct = norm_microEdge + (norm_mom1s * Math.sqrt(T_sec));
            } else if (T_sec <= 180) {
                // Short: 1m, 2m, 3m
                const velocity = norm_ret5 / 5.0;
                const accel = norm_accel / 5.0;
                expectedMovePct = (velocity * T_min) + (0.5 * accel * Math.pow(T_min, 2));
            } else {
                // Medium: 5m, 10m, 15m
                const trend_projection = (norm_ret15 / 15.0) * T_min;
                const knn_projection = norm_histEdge * (T_min / 15.0);
                expectedMovePct = (trend_projection + knn_projection) / 2.0;
            }
            
            const expectedPrice = (dir === 'LONG') 
                ? entryPrice * (1 + expectedMovePct / 100)
                : entryPrice * (1 - expectedMovePct / 100);
            
            const actualMoveNormalized = (dir === 'LONG') 
                ? ((cp.price - entryPrice) / entryPrice) * 100
                : ((entryPrice - cp.price) / entryPrice) * 100;
                
            const predictionErrorPct = actualMoveNormalized - expectedMovePct;
            
            if (errors[T_sec]) {
                errors[T_sec].push(Math.abs(predictionErrorPct));
                totalCheckpoints++;
            }
        }
    }
}

console.log(`Evaluated ${totalCheckpoints} checkpoints.`);
console.log("Mean Absolute Prediction Error (MAPE) by Horizon:");
for (const T_sec of Object.keys(errors).sort((a,b)=>a-b)) {
    const errs = errors[T_sec];
    if (errs.length === 0) continue;
    const avg = errs.reduce((a,b)=>a+b, 0) / errs.length;
    console.log(`${T_sec}s: ${avg.toFixed(4)}%  (n=${errs.length})`);
}
