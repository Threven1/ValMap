// Collects the bug reports sent with the app's "Report a bug" button into bug-reports.json.
//
//   node tools/export-bug-reports.js
//
// Reports are GitHub issues titled "Bug report: ..." on the public repository, so no login is
// needed to read them. Each report is checked again with js/bugcheck.js: anything that does not
// pass (for example an issue written on GitHub directly) is kept but marked "flagged".

const fs = require('fs');
const path = require('path');
const BUGCHECK = require('../js/bugcheck.js');

const REPO = 'Threven1/ValMap';
const TITLES = ['Feedback: ', 'Bug report: '];   // older reports used the second

(async () => {
  const reports = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues?state=all&per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ValMap-bug-export' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`);
    const issues = await res.json();
    if (!issues.length) break;
    for (const issue of issues) {
      if (issue.pull_request || !TITLES.some(t => issue.title.startsWith(t))) continue;
      // The report is the text above the "---" line the app adds.
      const text = (issue.body || '').split('\n\n---')[0];
      const result = BUGCHECK.check(text);
      reports.push({
        number: issue.number,
        state: issue.state,
        created: issue.created_at,
        report: result.text || null,
        flagged: result.error || false,
        url: issue.html_url,
      });
    }
  }
  const out = path.join(__dirname, '..', 'bug-reports.json');
  fs.writeFileSync(out, JSON.stringify(reports, null, 2) + '\n');
  const flagged = reports.filter(r => r.flagged).length;
  console.log(`Saved ${reports.length} bug reports to bug-reports.json (${flagged} flagged)`);
})().catch(e => { console.error(e.message); process.exit(1); });
