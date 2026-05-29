const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = { console: [], page: [], http: [] };
  page.on('console', msg => errors.console.push('['+msg.type()+'] '+msg.text()));
  page.on('pageerror', err => errors.page.push(err.message));
  page.on('response', resp => { if (resp.status() >= 400) errors.http.push(resp.status()+' '+resp.url()); });
  
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle', timeout: 20000 }).catch(e => errors.page.push('NAV: '+e.message));
  await page.waitForTimeout(5000);

  const title = await page.title();
  const bodyText = await page.innerText('body').catch(() => '');
  const rootHTML = await page.innerHTML('#root').catch(() => '');

  console.log('=== PAGE INFO ===');
  console.log('TITLE:', title);
  console.log('BODY_TEXT_LENGTH:', bodyText.length);

  const checks = {};
  checks.title = bodyText.includes('AIONCLAW');
  checks.agents = (bodyText.match(/CEO|Developer|Lead Finder|Memory Keeper|Sales/gi) || []).length;
  checks.project = bodyText.includes('Project');
  checks.teamActivity = bodyText.includes('Team Activity');
  console.log('=== UI CHECKS ===');
  Object.entries(checks).forEach(([k,v]) => console.log('  '+k+': '+(v?'PASS':'FAIL')));

  // Check buttons
  const btns = await page.locator('button').all();
  const btnTexts = [];
  for (const btn of btns) {
    const text = await btn.innerText().catch(() => '');
    if (text.trim()) btnTexts.push(text.trim());
  }
  console.log('=== BUTTONS ('+btnTexts.length+') ===');
  console.log(btnTexts.slice(0, 30).join(', '));

  // Click Settings
  const settingsBtn = await page.locator('button:has-text("Settings")');
  if (await settingsBtn.count() > 0) {
    await settingsBtn.click();
    await page.waitForTimeout(1500);
    const panelText = await page.innerText('.p-3.overflow-y-auto').catch(() => 'no panel');
    console.log('=== SETTINGS PANEL ===');
    console.log(panelText.substring(0, 400));
    const closeBtn = await page.locator('.p-3.overflow-y-auto button:has-text("✕")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
  }
  // Click Files
  const filesBtn = await page.locator('button:has-text("Files")');
  if (await filesBtn.count() > 0) {
    await filesBtn.click();
    await page.waitForTimeout(1500);
    const panelText = await page.innerText('.p-3.overflow-y-auto').catch(() => 'no panel');
    console.log('=== FILES PANEL ===');
    console.log(panelText.substring(0, 400));
    const closeBtn = await page.locator('.p-3.overflow-y-auto button:has-text("✕")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
  }
  // Click Leads
  const leadsBtn = await page.locator('button:has-text("Leads")');
  if (await leadsBtn.count() > 0) {
    await leadsBtn.click();
    await page.waitForTimeout(1500);
    const panelText = await page.innerText('.p-3.overflow-y-auto').catch(() => 'no panel');
    console.log('=== LEADS PANEL ===');
    console.log(panelText.substring(0, 400));
  }

  console.log('=== ERRORS ===');
  console.log('Console errors:', errors.console.length);
  errors.console.filter(e => e.startsWith('[error]')||e.startsWith('[warning]')).slice(0, 10).forEach(e => console.log('  '+e));
  console.log('Page errors:', errors.page.length);
  errors.page.forEach(e => console.log('  '+e));
  console.log('HTTP errors:', errors.http.length);
  errors.http.slice(0, 10).forEach(e => console.log('  '+e));

  await page.screenshot({ path: '/tmp/aion_screenshot_full.png', fullPage: true });
  console.log('=== SCREENSHOT /tmp/aion_screenshot_full.png ===');
  await browser.close();
})();
