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

    if (closedTrades.length === 0) {
      return NextResponse.json({ content: 'No fully closed trades found in the current session yet.\n\nWait for an open position to close.' });
    }

    let reportMarkdown = `# BOT VS MARKET ANALYSIS\n\n`;
    reportMarkdown += `*Analyzing ${closedTrades.length} fully closed trade(s) from session ${stateData.sessionId}*\n\n---\n\n`;

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
        
        reportMarkdown += `## Trade ${tradeId}\n`;
        reportMarkdown += `**${direction}**\n`;
        reportMarkdown += `Entry: ${entryPrice != null ? entryPrice.toFixed(2) : 'N/A'}\n`;
        if (entryTime) {
            reportMarkdown += `Entry Time: ${new Date(entryTime).toISOString()}\n`;
        }
        reportMarkdown += `\nFinal Result:\n`;
        reportMarkdown += `Exit: ${exitPrice != null ? exitPrice.toFixed(2) : 'N/A'}\n`;
        reportMarkdown += `P&L: $${netPnlUsdt.toFixed(4)}\n`;
        reportMarkdown += `Outcome: ${netPnlUsdt > 0 ? 'WIN' : 'LOSS'} (${exitReason})\n\n`;

        reportMarkdown += `Prediction Checkpoints:\n\n`;

        if (analytics && analytics.predictionHistory && analytics.predictionHistory.length > 0) {
          reportMarkdown += `| Trade | Direction | Time | Entry | Bot Expected | Actual Market | Difference | Prediction Error |\n`;
          reportMarkdown += `|-------|-----------|------|-------|--------------|---------------|------------|------------------|\n`;
          for (const cp of analytics.predictionHistory) {
              const timeStr = cp.elapsedSeconds < 60 ? `${cp.elapsedSeconds}s` : `${Math.floor(cp.elapsedSeconds / 60)}m${cp.elapsedSeconds % 60 ? (cp.elapsedSeconds % 60) + 's' : ''}`;
              
              const expected = cp.expectedMovePct != null ? (cp.expectedMovePct >= 0 ? '+' : '') + cp.expectedMovePct.toFixed(3) + '%' : 'N/A';
              const actual = cp.actualMovePct != null ? (cp.actualMovePct >= 0 ? '+' : '') + cp.actualMovePct.toFixed(3) + '%' : 'N/A';
              const diff = cp.predictionErrorPct != null ? (cp.predictionErrorPct >= 0 ? '+' : '') + cp.predictionErrorPct.toFixed(3) + '%' : 'N/A';
              
              reportMarkdown += `| ${tradeId} | ${direction} | ${timeStr} | ${entryPrice != null ? entryPrice.toFixed(2) : 'N/A'} | ${expected} | ${actual} | ${diff} | ${diff} |\n`;
          }
          reportMarkdown += `\n`;
        } else {
          reportMarkdown += `*No checkpoints recorded for this trade.*\n\n`;
        }

        reportMarkdown += `---\n\n`;

      } catch (e: any) {
        reportMarkdown += `\n*Error processing trade ${trade.tradeId}: ${e.message}*\n\n`;
      }
    }

    const openPositions = (stateData.candidates?.CONFLUENCE?.positions || []);
    if (openPositions.length > 0) {
      reportMarkdown = `# LIVE BOT VS MARKET\n\n` + 
                       `*Showing latest available checkpoint for ${openPositions.length} active open trade(s)*\n\n---\n\n` + 
                       reportMarkdown;
                       
      let liveMarkdown = '';
      for (const trade of openPositions) {
        try {
          const tradeId = trade.tradeId || (trade.entryTs ? `OPEN-${trade.entryTs}` : 'Unknown');
          const direction = trade.dir ?? 'UNKNOWN';
          const entryPrice = trade.entryPrice ?? null;
          const analytics = trade.analytics || null;
          
          if (analytics && analytics.predictionHistory && analytics.predictionHistory.length > 0) {
             const cp = analytics.predictionHistory[analytics.predictionHistory.length - 1]; // latest checkpoint
             liveMarkdown += `## Trade ${tradeId} (LIVE)\n`;
             liveMarkdown += `**${direction}**\n`;
             liveMarkdown += `| Trade | Direction | Time | Entry | Bot Expected | Actual Market | Difference | Prediction Error |\n`;
             liveMarkdown += `|-------|-----------|------|-------|--------------|---------------|------------|------------------|\n`;
             
             const timeStr = cp.elapsedSeconds < 60 ? `${cp.elapsedSeconds}s` : `${Math.floor(cp.elapsedSeconds / 60)}m${cp.elapsedSeconds % 60 ? (cp.elapsedSeconds % 60) + 's' : ''}`;
             const expected = cp.expectedMovePct != null ? (cp.expectedMovePct >= 0 ? '+' : '') + cp.expectedMovePct.toFixed(3) + '%' : 'N/A';
             const actual = cp.actualMovePct != null ? (cp.actualMovePct >= 0 ? '+' : '') + cp.actualMovePct.toFixed(3) + '%' : 'N/A';
             const diff = cp.predictionErrorPct != null ? (cp.predictionErrorPct >= 0 ? '+' : '') + cp.predictionErrorPct.toFixed(3) + '%' : 'N/A';
             
             liveMarkdown += `| ${tradeId} | ${direction} | ${timeStr} | ${entryPrice != null ? entryPrice.toFixed(2) : 'N/A'} | ${expected} | ${actual} | ${diff} | ${diff} |\n\n`;
          }
        } catch(e) {}
      }
      
      reportMarkdown = liveMarkdown + reportMarkdown;
    }

    return NextResponse.json({
      success: true,
      content: reportMarkdown
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
