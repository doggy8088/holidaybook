import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  cname: resolve(root, "public/CNAME"),
  html: resolve(root, "public/index.html"),
  css: resolve(root, "public/styles.css"),
  app: resolve(root, "public/app.js"),
};
const errors = [];

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readRequired(label, path) {
  check(existsSync(path), `${label} is missing: ${path}`);
  if (!existsSync(path)) {
    return "";
  }

  const content = readFileSync(path, "utf8");
  check(content.trim().length > 0, `${label} is empty: ${path}`);
  return content;
}

function matchingBlocks(source, openingPattern) {
  const pattern = new RegExp(openingPattern.source, openingPattern.flags.includes("g")
    ? openingPattern.flags
    : `${openingPattern.flags}g`);
  const blocks = [];
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const open = source.indexOf("{", match.index);
    let depth = 0;

    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") {
        depth += 1;
      } else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(open + 1, index));
          pattern.lastIndex = index + 1;
          break;
        }
      }
    }
  }

  return blocks;
}

function ruleBody(source, selector) {
  return matchingBlocks(source, new RegExp(`${selector}\\s*\\{`, "i"))[0] ?? "";
}

function hasDeclaration(body, property, value) {
  return new RegExp(`${property}\\s*:\\s*${value}\\s*;`, "i").test(body);
}

function hasThemeVariables(body) {
  return ["--bg", "--surface", "--text"].every((property) =>
    new RegExp(`${property}\\s*:`, "i").test(body));
}

/* Returns the inner markup of the first matching element, tracking nesting of
   the same tag so a scoped assertion cannot silently read past the element. */
function elementBlock(source, tag, attributePattern) {
  const opening = new RegExp(`<${tag}\\b(?=[^>]*\\b${attributePattern})[^>]*>`, "i");
  const found = source.match(opening);
  if (!found) return "";

  const start = found.index + found[0].length;
  const boundaries = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  boundaries.lastIndex = start;
  let depth = 1;
  let match;

  while ((match = boundaries.exec(source)) !== null) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return source.slice(start, match.index);
  }

  return "";
}

/* Install one-liners contain characters that must be escaped in HTML, so the
   markup is compared against the real command rather than its entity form.

   This is a true single pass: every reference is consumed by one regex match
   and the replacement output is never rescanned. That ordering matters, because
   chained replacements would mis-handle an escaped ampersand followed by an
   entity name -- "&#38;amp;" is the HTML source for the literal text "&amp;",
   not for "&". For the same reason "&amp;lt;" must decode to the literal text
   "&lt;" and never to "<"; decoding it twice is the classic double-decode bug. */
const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: '"',
};

const MAX_CODE_POINT = 0x10ffff;

/* Only Unicode scalar values can be materialised: String.fromCodePoint throws a
   RangeError above U+10FFFF, and lone surrogates would produce unusable text.
   Anything else is left as written so a malformed reference surfaces as a normal
   contract failure instead of crashing the whole check. */
function fromCodePoint(value, original) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_CODE_POINT) return original;
  if (value >= 0xd800 && value <= 0xdfff) return original;
  return String.fromCodePoint(value);
}

function decodeEntities(source) {
  return source.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (match, decimal, hex, name) => {
      if (decimal !== undefined) return fromCodePoint(Number(decimal), match);
      if (hex !== undefined) return fromCodePoint(parseInt(hex, 16), match);
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      return decoded === undefined ? match : decoded;
    },
  );
}

const cname = readRequired("GitHub Pages CNAME", paths.cname);
const html = readRequired("Page HTML", paths.html);
const css = readRequired("Page stylesheet", paths.css);
readRequired("Page JavaScript", paths.app);

check(
  cname.trim() === "holiday.gh.miniasp.com",
  'public/CNAME must contain exactly "holiday.gh.miniasp.com".',
);

const metadataChecks = [
  [/<html\b[^>]*\blang=["']zh-Hant["']/i, 'the page language lang="zh-Hant"'],
  [/<meta\b[^>]*\bcharset=["']?UTF-8["']?/i, "UTF-8 charset metadata"],
  [/<meta\b[^>]*\bname=["']viewport["'][^>]*\bcontent=["'][^"']*width=device-width/i, "viewport metadata"],
  [/<title>\s*[^<]*台灣假期速查[^<]*<\/title>/i, "a descriptive page title"],
  [/<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["'][^"']+["']/i, "meta description"],
  [/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']https:\/\/holiday\.gh\.miniasp\.com\/["']/i, "canonical URL"],
  [/<meta\b[^>]*\bproperty=["']og:type["'][^>]*\bcontent=["']website["']/i, "Open Graph type"],
  [/<meta\b[^>]*\bproperty=["']og:title["'][^>]*\bcontent=["'][^"']+["']/i, "Open Graph title"],
  [/<meta\b[^>]*\bproperty=["']og:description["'][^>]*\bcontent=["'][^"']+["']/i, "Open Graph description"],
  [/<meta\b[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["']https:\/\/holiday\.gh\.miniasp\.com\/["']/i, "Open Graph URL"],
  [/<meta\b[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']https:\/\/holiday\.gh\.miniasp\.com\/assets\/og-taiwan-holiday\.jpg["']/i, "an absolute Open Graph image URL"],
  [/<meta\b[^>]*\bproperty=["']og:image:alt["'][^>]*\bcontent=["'][^"']+["']/i, "Open Graph image alt text"],
  [/<meta\b[^>]*\bname=["']twitter:card["'][^>]*\bcontent=["']summary_large_image["']/i, "a large-image Twitter card"],
  [/<meta\b[^>]*\bname=["']twitter:image["'][^>]*\bcontent=["']https:\/\/holiday\.gh\.miniasp\.com\/assets\/og-taiwan-holiday\.jpg["']/i, "an absolute Twitter card image URL"],
  [/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>/i, "JSON-LD metadata"],
  [/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']styles\.css["']/i, "styles.css asset reference"],
  [/<script\b[^>]*\bsrc=["']app\.js["'][^>]*\bdefer\b[^>]*>/i, "deferred app.js asset reference"],
];

for (const [pattern, label] of metadataChecks) {
  check(pattern.test(html), `public/index.html is missing ${label}.`);
}

check(
  /<[^>]+\bid=["']theme-toggle["'][^>]*>/i.test(html),
  'public/index.html must include the theme control id="theme-toggle".',
);

const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)];
const themeBootstrap = inlineScripts.find((match) => match[1].includes("holidaybook-theme"));
const stylesheetIndex = html.search(
  /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']styles\.css["']/i,
);
check(
  Boolean(themeBootstrap),
  'public/index.html must include an inline theme bootstrap using "holidaybook-theme".',
);

if (themeBootstrap) {
  const bootstrap = themeBootstrap[1];
  const validThemeGuard = (
    /["']light["'][\s\S]{0,240}(?:\|\||&&)[\s\S]{0,240}["']dark["']/i.test(bootstrap)
    || /["']dark["'][\s\S]{0,240}(?:\|\||&&)[\s\S]{0,240}["']light["']/i.test(bootstrap)
    || /(?:includes|has)\s*\([^)]*\)/i.test(bootstrap)
  );

  check(
    themeBootstrap.index < stylesheetIndex,
    "The theme bootstrap must run before styles.css loads to avoid a theme flash.",
  );
  check(
    /localStorage\s*\.\s*getItem\s*\(/i.test(bootstrap),
    'The theme bootstrap must read localStorage key "holidaybook-theme".',
  );
  check(
    validThemeGuard && /["']light["']/i.test(bootstrap) && /["']dark["']/i.test(bootstrap),
    'The theme bootstrap must accept only the stored values "light" and "dark".',
  );
  check(
    /document\s*\.\s*documentElement/i.test(bootstrap)
      && /(?:dataset\s*\.\s*theme\s*=|setAttribute\s*\(\s*["']data-theme["'])/i.test(bootstrap),
    "The theme bootstrap must apply the validated value to the root data-theme attribute.",
  );
}

/* Attributes are matched with independent lookaheads so that reordering them --
   which is semantically identical HTML -- cannot cause a false failure, while
   every required attribute is still mandatory. */
function hasAttributes(tag, attributes) {
  const lookaheads = attributes.map((attribute) => `(?=[^>]*\\b${attribute})`).join("");
  return new RegExp(`<${tag}\\b${lookaheads}[^>]*>`, "i");
}

check(
  hasAttributes("div", [
    String.raw`class=["'][^"']*\bquick-dates\b[^"']*["']`,
    String.raw`role=["']group["']`,
  ]).test(html),
  'The .quick-dates container must include role="group".',
);

const codeBlockCount = [...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bcode-block\b[^"']*["'][^>]*>/gi)].length;
const codePreMatches = [...html.matchAll(/<pre\b([^>]*)>\s*<code\b/gi)];
check(codeBlockCount === 9, `Expected 9 .code-block elements, found ${codeBlockCount}.`);
check(codePreMatches.length === 9, `Expected 9 code-block <pre> elements, found ${codePreMatches.length}.`);
codePreMatches.forEach((match, index) => {
  check(
    /\btabindex=["']0["']/i.test(match[1]),
    `Code-block <pre> ${index + 1} must include tabindex="0".`,
  );
});

/* The one-command install section is the primary conversion path for the CLI,
   so its anchor, exact commands and copy wiring are pinned here rather than
   left to a visual review. Everything the messages describe as belonging to the
   install section is matched against that section only: the same link or wording
   appearing elsewhere on the page must never mask a regression inside it. */
check(
  hasAttributes("section", [
    String.raw`id=["']install["']`,
    String.raw`aria-labelledby=["']install-heading["']`,
  ]).test(html),
  'The page must contain <section id="install"> labelled by install-heading.',
);

const installSection = elementBlock(html, "section", String.raw`id=["']install["']`);
check(
  installSection.length > 0,
  'Could not read the contents of <section id="install">; is the closing tag missing?',
);
check(
  /<h2\b[^>]*\bid=["']install-heading["'][^>]*>/i.test(installSection),
  'The install section must have an <h2 id="install-heading">.',
);
check(
  /<nav\b[^>]*\bclass=["'][^"']*\bsite-nav\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*\bhref=["']#install["'][^>]*>\s*安裝\s*<\/a>[\s\S]*?<\/nav>/i.test(html),
  'The site navigation must link to #install with the label "安裝".',
);

/* The server-rendered HTML is the no-JavaScript fallback: both install
   sections remain visible and the inert tab controls stay hidden without
   claiming ARIA tab semantics. app.js applies the complete tablist/tab/
   tabpanel relationship before revealing the controls; its behavior is
   covered by tests/public-app.test.mjs. */
const installTabListMatch = installSection.match(
  /<div\b(?=[^>]*\bid=["']install-tabs-list["'])([^>]*)>/i,
);
check(Boolean(installTabListMatch), 'The install section must contain id="install-tabs-list".');
if (installTabListMatch) {
  const attrs = installTabListMatch[1];
  check(
    /\bclass=["'][^"']*\binstall-tabs__list\b[^"']*["']/i.test(attrs),
    "#install-tabs-list must use the .install-tabs__list class.",
  );
  check(
    /\bhidden(?:\s*=\s*(?:["'][^"']*["']|[^\s]+))?(?:\s|$)/i.test(attrs),
    "#install-tabs-list must stay hidden until JavaScript applies tab semantics.",
  );
  check(
    !/\brole\s*=|\baria-labelledby\s*=/i.test(attrs),
    "#install-tabs-list must not claim tablist semantics before JavaScript enhancement.",
  );
}

const INSTALL_TABS = [
  { tabId: "install-tab-posix", panelId: "install-panel-posix", label: /macOS/i },
  { tabId: "install-tab-powershell", panelId: "install-panel-powershell", label: /PowerShell/i },
];

for (const { tabId, panelId, label } of INSTALL_TABS) {
  const tabMatch = installSection.match(
    new RegExp(`<button\\b([^>]*\\bid=["']${tabId}["'][^>]*)>([\\s\\S]*?)</button>`, "i"),
  );
  check(Boolean(tabMatch), `The install section must contain a tab button id="${tabId}".`);
  if (tabMatch) {
    const [, attrs, text] = tabMatch;
    check(
      /\btype=["']button["']/i.test(attrs),
      `#${tabId} must remain a non-submitting button.`,
    );
    check(
      !/\brole\s*=|\baria-controls\s*=|\baria-selected\s*=|\btabindex\s*=/i.test(attrs),
      `#${tabId} must not claim tab semantics before JavaScript enhancement.`,
    );
    check(label.test(decodeEntities(text)), `The #${tabId} label must mention ${label}.`);
  }

  const panelMatch = installSection.match(
    new RegExp(`<div\\b([^>]*\\bid=["']${panelId}["'][^>]*)>`, "i"),
  );
  check(Boolean(panelMatch), `The install section must contain an install panel id="${panelId}".`);
  if (panelMatch) {
    const attrs = panelMatch[1];
    check(
      !/\brole\s*=|\baria-labelledby\s*=|\btabindex\s*=|\bhidden(?:\s|=|$)/i.test(attrs),
      `#${panelId} must remain visible and semantically ordinary before JavaScript enhancement.`,
    );
  }
}

const INSTALL_COMMANDS = [
  {
    id: "install-posix",
    label: "macOS / Linux",
    command: "curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh",
  },
  {
    id: "install-powershell",
    label: "Windows PowerShell",
    command: "irm https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.ps1 | iex",
  },
];

for (const { id, label, command } of INSTALL_COMMANDS) {
  const codeMatch = installSection.match(new RegExp(`<code\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</code>`, "i"));
  check(Boolean(codeMatch), `The install section must contain <code id="${id}"> for ${label}.`);
  if (codeMatch) {
    check(
      decodeEntities(codeMatch[1]).trim() === command,
      `The ${label} install command must be exactly "${command}".`,
    );
  }

  const copyButton = installSection.match(new RegExp(`<button\\b([^>]*\\bdata-copy-target=["']${id}["'][^>]*)>`, "i"));
  check(
    Boolean(copyButton),
    `The ${label} install command needs a copy button with data-copy-target="${id}".`,
  );
  if (copyButton) {
    check(
      /\bclass=["'][^"']*\bcode-block__copy\b[^"']*["']/i.test(copyButton[1]),
      `The ${label} copy button must reuse the .code-block__copy behaviour.`,
    );
  }

  const preMatch = installSection.match(new RegExp(`<pre\\b([^>]*)>\\s*<code\\b[^>]*\\bid=["']${id}["']`, "i"));
  check(Boolean(preMatch), `The ${label} command must live inside a <pre> element.`);
  if (preMatch) {
    check(
      /\btabindex=["']0["']/i.test(preMatch[1]),
      `The ${label} command block must be keyboard focusable with tabindex="0".`,
    );
  }
}

const npmInstallBlock = elementBlock(installSection, "div", String.raw`id=["']npm-install-card["']`);
check(
  npmInstallBlock.length > 0,
  'Could not read the npm install subsection (<div id="npm-install-card">) inside the install section.',
);
check(
  hasAttributes("div", [
    String.raw`id=["']npm-install-card["']`,
    String.raw`role=["']region["']`,
    String.raw`aria-labelledby=["']npm-install-heading["']`,
  ]).test(installSection),
  'The npm install subsection must be a region landmark labelled by npm-install-heading.',
);
check(
  /<h3\b[^>]*\bid=["']npm-install-heading["'][^>]*>/i.test(npmInstallBlock),
  'The npm install subsection must have an <h3 id="npm-install-heading">.',
);
const npmInstallCodeMatch = npmInstallBlock.match(
  /<code\b[^>]*\bid=["']npm-install["'][^>]*>([\s\S]*?)<\/code>/i,
);
check(Boolean(npmInstallCodeMatch), 'The npm install subsection must contain <code id="npm-install">.');
if (npmInstallCodeMatch) {
  check(
    decodeEntities(npmInstallCodeMatch[1]).trim() === "npm install -g holidaytw",
    'The npm install command must be exactly "npm install -g holidaytw".',
  );
}
const npmInstallCopyButton = npmInstallBlock.match(
  /<button\b([^>]*\bdata-copy-target=["']npm-install["'][^>]*)>/i,
);
check(
  Boolean(npmInstallCopyButton),
  'The npm install command needs a copy button with data-copy-target="npm-install".',
);
if (npmInstallCopyButton) {
  check(
    /\bclass=["'][^"']*\bcode-block__copy\b[^"']*["']/i.test(npmInstallCopyButton[1]),
    'The npm install copy button must reuse the .code-block__copy behaviour.',
  );
}
const npmInstallPreMatch = npmInstallBlock.match(
  /<pre\b([^>]*)>\s*<code\b[^>]*\bid=["']npm-install["']/i,
);
check(Boolean(npmInstallPreMatch), "The npm install command must live inside a <pre> element.");
if (npmInstallPreMatch) {
  check(
    /\btabindex=["']0["']/i.test(npmInstallPreMatch[1]),
    'The npm install command block must be keyboard focusable with tabindex="0".',
  );
}
check(
  /npx\s+holidaytw/i.test(npmInstallBlock),
  'The npm install subsection must document the npx holidaytw path.',
);

check(
  /<a\b[^>]*\bhref=["']https:\/\/github\.com\/doggy8088\/holidaybook\/releases["'][^>]*>/i.test(installSection),
  "The install section must link to https://github.com/doggy8088/holidaybook/releases for versioned or manual installs.",
);
check(
  /SHA-256/i.test(installSection) && /checksums\.txt/i.test(installSection),
  "The install section must state that the installer verifies the release SHA-256 against checksums.txt.",
);
check(
  /Programs\\holidaytw/i.test(installSection),
  'The install section must show the Windows install path using the "holidaytw" executable name.',
);
check(
  !/Programs\\holidaybook/i.test(installSection),
  'The install section must not show the old "holidaybook" executable name in the Windows install path.',
);

/* The CLI is distributed as "holidaytw"; the npm package name and native
   executable name intentionally match.
   The GitHub repository slug doggy8088/holidaybook, the API domain, and the
   install.sh/install.ps1 filenames are unaffected by this rename and are
   deliberately left out of this check. */
const cliSection = elementBlock(html, "section", String.raw`id=["']cli["']`);
check(
  cliSection.length > 0,
  'Could not read the contents of <section id="cli">; is the closing tag missing?',
);
check(
  /<code\b[^>]*>\s*holidaytw\s*<\/code>\s*CLI/i.test(cliSection),
  'The CLI section must introduce the installed executable as "holidaytw".',
);

const CLI_EXAMPLES = [
  { id: "cli-example-1", command: "holidaytw 2025-07-20" },
  { id: "cli-example-2", command: "holidaytw --json 2025-07-20" },
];

for (const { id, command } of CLI_EXAMPLES) {
  const codeMatch = cliSection.match(new RegExp(`<code\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</code>`, "i"));
  check(Boolean(codeMatch), `The CLI section must contain <code id="${id}"> for the holidaytw example.`);
  if (codeMatch) {
    check(
      decodeEntities(codeMatch[1]).trim() === command,
      `The #${id} CLI example must be exactly "${command}".`,
    );
  }
}

check(
  !/\bholidaybook\b/i.test(cliSection),
  'The CLI section must not reference the old "holidaybook" executable name.',
);

/* Agent Skill install path: the plain repository shorthand "owner/repo", which
   the skills CLI resolves to the root skill/SKILL.md definition (recorded in
   its skills-lock.json), distinct from the .github/skills copy, documented
   inside the install section. The primary command must stay the plain
   "npx skills add ..." form -- never "--all" by default, since that installs
   to every supported agent at once. */
const agentSkillBlock = elementBlock(installSection, "div", String.raw`id=["']agent-skill["']`);
check(
  agentSkillBlock.length > 0,
  'Could not read the contents of the Agent Skill subsection (<div id="agent-skill">) inside the install section.',
);
check(
  hasAttributes("div", [
    String.raw`id=["']agent-skill["']`,
    String.raw`role=["']region["']`,
    String.raw`aria-labelledby=["']agent-skill-heading["']`,
  ]).test(installSection),
  'The Agent Skill subsection must be a region landmark labelled by agent-skill-heading.',
);
check(
  /<h3\b[^>]*\bid=["']agent-skill-heading["'][^>]*>/i.test(agentSkillBlock),
  'The Agent Skill subsection must have an <h3 id="agent-skill-heading">.',
);

const AGENT_SKILL_COMMAND =
  "npx skills add doggy8088/holidaybook";
const agentSkillCodeMatch = agentSkillBlock.match(
  /<code\b[^>]*\bid=["']agent-skill-install["'][^>]*>([\s\S]*?)<\/code>/i,
);
check(
  Boolean(agentSkillCodeMatch),
  'The Agent Skill subsection must contain <code id="agent-skill-install">.',
);
if (agentSkillCodeMatch) {
  check(
    decodeEntities(agentSkillCodeMatch[1]).trim() === AGENT_SKILL_COMMAND,
    `The Agent Skill install command must be exactly "${AGENT_SKILL_COMMAND}".`,
  );
}

const agentSkillCopyButton = agentSkillBlock.match(
  /<button\b([^>]*\bdata-copy-target=["']agent-skill-install["'][^>]*)>/i,
);
check(
  Boolean(agentSkillCopyButton),
  'The Agent Skill install command needs a copy button with data-copy-target="agent-skill-install".',
);
if (agentSkillCopyButton) {
  check(
    /\bclass=["'][^"']*\bcode-block__copy\b[^"']*["']/i.test(agentSkillCopyButton[1]),
    "The Agent Skill copy button must reuse the .code-block__copy behaviour.",
  );
}

const agentSkillPreMatch = agentSkillBlock.match(
  /<pre\b([^>]*)>\s*<code\b[^>]*\bid=["']agent-skill-install["']/i,
);
check(Boolean(agentSkillPreMatch), "The Agent Skill command must live inside a <pre> element.");
if (agentSkillPreMatch) {
  check(
    /\btabindex=["']0["']/i.test(agentSkillPreMatch[1]),
    'The Agent Skill command block must be keyboard focusable with tabindex="0".',
  );
}

check(
  /skill\/SKILL\.md/i.test(agentSkillBlock) && /\.github\/skills/i.test(agentSkillBlock),
  'The Agent Skill subsection must explain the root skill/SKILL.md path versus .github/skills.',
);
check(
  /npx\s+--yes\s+holidaytw/i.test(agentSkillBlock) &&
    /npm/i.test(agentSkillBlock) &&
    /正式發布/i.test(agentSkillBlock) &&
    /名稱所有權/i.test(agentSkillBlock),
  "The Agent Skill subsection must document the trusted, officially published npm path.",
);
check(
  /(macOS|Linux)/i.test(agentSkillBlock) && /Windows/i.test(agentSkillBlock),
  "The Agent Skill subsection must mention the matching macOS/Linux or Windows installer fallback.",
);
check(
  /HTTPS|JSON/i.test(agentSkillBlock) && /API/i.test(agentSkillBlock),
  "The Agent Skill subsection must mention the HTTPS JSON API fallback.",
);

/* The official Skills CLI documents --all after the repo shorthand; the wrong
   order is checked for explicitly so a future edit cannot silently regress it. */
const ALL_AGENTS_COMMAND =
  "npx skills add doggy8088/holidaybook --all";
check(
  agentSkillBlock.includes(ALL_AGENTS_COMMAND),
  `The Agent Skill subsection must show the optional all-agents example in the documented argument order: "${ALL_AGENTS_COMMAND}".`,
);
check(
  !/npx\s+skills\s+add\s+--all\s+\S/i.test(agentSkillBlock),
  'The Agent Skill subsection must not show "--all" placed before the repository argument.',
);

/* The footnote must describe "latest release" dynamically so it never goes
   stale the moment a new version ships; no hard-coded version number. */
check(
  /latest release/i.test(installSection),
  'The install section footnote must describe the unversioned default as "latest release".',
);
check(
  !/\bv\d+\.\d+\.\d+\b/.test(installSection),
  "The install section must not hard-code a specific release version number.",
);

const images = [...html.matchAll(/<img\b([^>]*)>/gi)].map((match) => match[1]);
const attr = (source, name) => {
  const found = source.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return found ? found[1] : null;
};

check(images.length >= 4, `Expected at least 4 <img> elements, found ${images.length}.`);
images.forEach((source) => {
  const src = attr(source, "src") ?? "(unknown src)";
  check(Boolean(attr(source, "alt")?.trim()), `Image ${src} must have non-empty alt text.`);
  check(
    Boolean(attr(source, "width")) && Boolean(attr(source, "height")),
    `Image ${src} must declare explicit width and height to keep layout stable.`,
  );
});

const heroImage = images.find((source) => (attr(source, "src") ?? "").includes("taiwan-coast-hero.jpg"));
check(Boolean(heroImage), "The hero must use assets/taiwan-coast-hero.jpg.");
if (heroImage) {
  check(
    /\bfetchpriority=["']high["']/i.test(heroImage),
    'The hero image must set fetchpriority="high" for LCP.',
  );
  check(
    !/\bloading=["']lazy["']/i.test(heroImage),
    "The above-the-fold hero image must not be lazy loaded.",
  );
}

for (const lazyAsset of ["taiwan-civic-street.jpg", "taiwan-calendar-still-life.jpg"]) {
  const image = images.find((source) => (attr(source, "src") ?? "").includes(lazyAsset));
  check(Boolean(image), `The supporting image assets/${lazyAsset} must be used on the page.`);
  if (image) {
    check(
      /\bloading=["']lazy["']/i.test(image),
      `The below-the-fold image ${lazyAsset} must set loading="lazy".`,
    );
  }
}

const flagImage = images.find((source) => (attr(source, "src") ?? "").includes("taiwan-flag.svg"));
check(
  Boolean(flagImage),
  "The Taiwan flag asset assets/taiwan-flag.svg must be shown on the page.",
);

check(
  /Copyright\s*©\s*2026\s*<a\b[^>]*\bhref=["']https:\/\/www\.facebook\.com\/will\.fans\/["'][^>]*>\s*Will 保哥\s*<\/a>/.test(html),
  'The footer must read "Copyright © 2026 Will 保哥" with only "Will 保哥" linking to https://www.facebook.com/will.fans/.',
);

[...html.matchAll(/<a\b([^>]*)>/gi)]
  .map((match) => match[1])
  .filter((source) => /\btarget=["']_blank["']/i.test(source))
  .forEach((source) => {
    check(
      /\brel=["'][^"']*\bnoopener\b[^"']*["']/i.test(source),
      `Links opening a new tab must set rel="noopener": <a${source}>`,
    );
  });

const splitBody = ruleBody(css, String.raw`\.split\s*>\s*\*`);
check(splitBody.length > 0, "public/styles.css is missing the .split > * rule.");
check(
  hasDeclaration(splitBody, "min-width", "0"),
  "The .split > * rule must set min-width: 0.",
);

const ghostHoverBody = ruleBody(css, String.raw`\.btn--ghost:hover`);
check(ghostHoverBody.length > 0, "public/styles.css is missing the .btn--ghost:hover rule.");
check(
  hasDeclaration(ghostHoverBody, "background", String.raw`var\(\s*--accent-tint\s*\)`),
  "The .btn--ghost:hover rule must set background: var(--accent-tint).",
);

const visiblePanelDividerBody = ruleBody(
  css,
  String.raw`\.install-tabs__panel:not\(\[hidden\]\)\s*\+\s*\.install-tabs__panel:not\(\[hidden\]\)`,
);
check(
  hasDeclaration(visiblePanelDividerBody, "border-top", String.raw`1px\s+solid\s+var\(\s*--border\s*\)`),
  "The install-panel divider must appear only when both adjacent panels are visible.",
);
check(
  ruleBody(css, String.raw`\.install-tabs__panel\s*\+\s*\.install-tabs__panel`).length === 0,
  "The second install panel must not receive an unconditional top border while the first panel is hidden.",
);

const explicitDarkThemeBody = ruleBody(
  css,
  String.raw`(?:\:root|html)?\s*\[\s*data-theme\s*=\s*["']dark["']\s*\]`,
);
check(
  explicitDarkThemeBody.length > 0 && hasThemeVariables(explicitDarkThemeBody),
  'public/styles.css must define dark theme variables under [data-theme="dark"].',
);

const darkMediaBlocks = matchingBlocks(
  css,
  /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/gi,
);
const hasSafeDarkFallback = darkMediaBlocks.some((mediaBody) => {
  const excludesLightBody = ruleBody(
    mediaBody,
    String.raw`(?:\:root|html)\s*:not\(\s*\[\s*data-theme\s*=\s*["']light["']\s*\]\s*\)`,
  );
  const unthemedBody = ruleBody(
    mediaBody,
    String.raw`(?:\:root|html)\s*:not\(\s*\[\s*data-theme\s*\]\s*\)`,
  );
  const defaultDarkBody = ruleBody(mediaBody, String.raw`(?:\:root|html)`);
  const explicitLightBody = ruleBody(
    mediaBody,
    String.raw`(?:\:root|html)?\s*\[\s*data-theme\s*=\s*["']light["']\s*\]`,
  );

  return hasThemeVariables(excludesLightBody)
    || hasThemeVariables(unthemedBody)
    || (hasThemeVariables(defaultDarkBody) && hasThemeVariables(explicitLightBody));
});
check(
  hasSafeDarkFallback,
  'The dark prefers-color-scheme fallback must preserve an explicit [data-theme="light"] override.',
);

const responsiveMedia = matchingBlocks(
  css,
  /@media\s*\(\s*max-width\s*:\s*48rem\s*\)\s*,\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{/i,
)[0] ?? "";
check(
  responsiveMedia.length > 0,
  "Missing scoped @media (max-width: 48rem), (pointer: coarse) touch-target rules.",
);

const iconBody = ruleBody(responsiveMedia, String.raw`\.icon-btn`);
check(
  hasDeclaration(iconBody, "width", String.raw`2\.75rem`)
    && hasDeclaration(iconBody, "height", String.raw`2\.75rem`),
  "The scoped .icon-btn touch target must be 2.75rem wide and high.",
);

const quickButtonBody = ruleBody(
  responsiveMedia,
  String.raw`\.quick-dates\s+\.btn--small`,
);
check(
  hasDeclaration(quickButtonBody, "min-height", String.raw`2\.75rem`)
    && hasDeclaration(
      quickButtonBody,
      "padding-block",
      String.raw`(?:0?\.5rem|var\(\s*--space-2\s*\))`,
    ),
  "The scoped quick-date buttons must set min-height: 2.75rem and 0.5rem block padding.",
);

const navLinkBody = ruleBody(responsiveMedia, String.raw`\.site-nav\s+a`);
check(
  hasDeclaration(navLinkBody, "display", "inline-flex")
    && hasDeclaration(navLinkBody, "min-height", String.raw`2\.75rem`),
  "The scoped site navigation links must use inline-flex with min-height: 2.75rem.",
);

const copyButtonBody = ruleBody(responsiveMedia, String.raw`\.code-block__copy`);
check(
  hasDeclaration(copyButtonBody, "min-height", String.raw`2\.75rem`)
    && hasDeclaration(
      copyButtonBody,
      "padding-block",
      String.raw`(?:0?\.5rem|var\(\s*--space-2\s*\))`,
    ),
  "The scoped code-block copy buttons must set min-height: 2.75rem and 0.5rem block padding.",
);

if (errors.length > 0) {
  console.error(`Public site contract check failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Public site contract check passed.");
