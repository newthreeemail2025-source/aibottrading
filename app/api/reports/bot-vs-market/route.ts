export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const liveStatePath = path.join(process.cwd(), 'reports', 'live-state.json');

    if (!fs.existsSync(liveStatePath)) {
      return NextResponse.json({ error: 'live-state.json not found' }, { status: 404 });
    }

    const stateData = JSON.parse(fs.readFileSync(liveStatePath, 'utf-8'));
    const allTrades = stateData.allTrades || [];
    
    // Filter for fully closed trades
    const closedTrades = allTrades.filter((t: any) => t.status === 'COMPLETED_TRADE');
    const openPositions = (stateData.candidates?.CONFLUENCE?.positions || []);

    if (closedTrades.length === 0 && openPositions.length === 0) {
      return NextResponse.json({ content: 'No open trades and no closed trades found.' });
    }

    let reportMarkdown = '# Bot vs Market Analysis\n\n';

    // Helper to render checkpoint tables
    const renderCheckpoints = (tradeId: string, direction: string, entryPrice: number, analytics: any) => {
        let md = '';
        if (analytics && analytics.checkpoints && Object.keys(analytics.checkpoints).length > 0 && entryPrice != null) {
             md += `| Trade | Direction | Time | Entry | Bot Expected | Actual Market | Difference | Prediction Error |\n`;
             md += `|-------|-----------|------|-------|--------------|---------------|------------|------------------|\n`;
             
             // Sort checkpoints by time
             const checkpoints = Object.entries(analytics.checkpoints)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([key, cp]) => ({ key, cp: cp as any }));

             for (const { key, cp } of checkpoints) {
                 const elapsedMs = Number(key);
                 const elapsedSeconds = elapsedMs / 1000;
                 const timeStr = elapsedSeconds < 60 ? `${elapsedSeconds}s` : `${Math.floor(elapsedSeconds / 60)}m${elapsedSeconds % 60 ? (elapsedSeconds % 60) + 's' : ''}`;
                 
                 const expectedMove = cp.botExpectedMovePct || 0;
                 const errorMove = cp.predictionErrorPct || 0;
                 
                 const expectedPrice = cp.botExpectedPrice || entryPrice;
                 
                 const actualPrice = cp.price || entryPrice; // Raw market price from checkpoint
                 const priceDiff = actualPrice - expectedPrice;
                 
                 const diffSign = priceDiff >= 0 ? '+' : '-';
                 const errSign = errorMove >= 0 ? '+' : '';
                 
                 md += `| ${tradeId} | ${direction} | ${timeStr} | $${entryPrice.toFixed(2)} | $${expectedPrice.toFixed(2)} | $${actualPrice.toFixed(2)} | ${diffSign}$${Math.abs(priceDiff).toFixed(2)} | ${errSign}${errorMove.toFixed(2)}% |\n`;
             }
             md += `\n`;
        } else {
             md += `*No checkpoints recorded for this trade.*\n\n`;
        }
        return md;
    };

    // 1. Render LIVE OPEN TRADES
    if (openPositions.length > 0) {
      reportMarkdown += `## LIVE BOT VS MARKET\n\n`;
      
      for (const trade of openPositions) {
        try {
          // Fallback ID if missing
          const tradeId = trade.tradeId || (trade.entryTs ? `OPEN-${trade.entryTs}` : 'Unknown');
          const direction = trade.dir ?? 'UNKNOWN';
          const entryPrice = trade.entryPrice ?? null;
          const analytics = trade.analytics || null;
          
          reportMarkdown += `### LIVE TRADE ${tradeId} — ${direction}\n\n`;
          reportMarkdown += renderCheckpoints(tradeId, direction, entryPrice, analytics);
        } catch(e) {}
      }
    }

    // 2. Render CLOSED TRADES
    if (closedTrades.length > 0) {
      reportMarkdown += `## CLOSED TRADES\n\n`;

      for (const trade of closedTrades) {
        try {
          const tradeId = trade.tradeId ?? 'Unknown';
          const direction = trade.direction ?? 'UNKNOWN';
          const entryPrice = trade.entryPrice ?? null;
          const exitPrice = trade.exitPrice ?? null;
          const exitReason = trade.exitReason ?? 'UNKNOWN';
          const netPnlUsdt = trade.netPnlUsdt ?? 0;
          const entryTime = trade.entryTime ?? 0;
          const analytics = trade.analytics || trade.entryAnalytics || null;
          
          reportMarkdown += `### TRADE ${tradeId} — ${direction}\n\n`;
          
          if (entryPrice != null) {
              reportMarkdown += `Entry: $${entryPrice.toFixed(2)}\n`;
          }
          if (entryTime) {
              reportMarkdown += `Entry Time: ${new Date(entryTime).toISOString()}\n`;
          }
          reportMarkdown += `Exit: ${exitPrice != null ? '$' + exitPrice.toFixed(2) : 'N/A'}\n`;
          reportMarkdown += `P&L: $${netPnlUsdt.toFixed(4)} (${netPnlUsdt > 0 ? 'WIN' : 'LOSS'}) [${exitReason}]\n\n`;

          reportMarkdown += renderCheckpoints(tradeId, direction, entryPrice, analytics);

        } catch (e: any) {
          reportMarkdown += `\n*Error processing trade ${trade.tradeId}: ${e.message}*\n\n`;
        }
      }
    }

    return NextResponse.json({
      success: true,
      content: reportMarkdown
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
