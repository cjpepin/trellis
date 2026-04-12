import fs from "node:fs";
import path from "node:path";
import { fromRepoRoot } from "./lib/repo-paths.mjs";

const seedDir = fromRepoRoot("fixtures", "preview-seed");
const vaultDir = path.join(seedDir, "vault");
const wikiDir = path.join(vaultDir, "wiki");
const rawDir = path.join(vaultDir, "raw");

const baseDate = new Date("2026-04-01T16:00:00.000Z");
const previewVaultId = "preview-main-vault";
const noteFolderBySlug = {
  "ship-room-routine": "playbooks",
  "customer-advisory-cadence": "research",
  "onboarding-friction": "playbooks",
  "retention-loop": "playbooks",
  "office-hours-format": "playbooks",
  "research-queue": "research",
  "citation-hygiene": "research",
  "ambient-capture": "playbooks",
  "meeting-distillation": "playbooks",
  "support-inbox-patterns": "playbooks",
  "launch-week-checklist": "playbooks",
  "field-notes-design-partners": "research",
  "doc-style-guide": "writing",
  "hiring-product-engineer": "playbooks",
  "assistant-voice-and-tone": "writing",
  "edge-function-retries": "operations",
  "supabase-usage-notes": "operations",
  "graph-reading-ritual": "playbooks",
  "reading-list-systems": "research",
  "book-slow-product": "research",
  "article-calm-software": "research",
  "source-summary-privacy-report": "research",
  "source-summary-usage-study": "research",
  "source-summary-local-first-paper": "research",
  "source-summary-founder-interview": "research",
  "synthesis-activation-and-trust": "synthesis",
  "synthesis-support-signals": "synthesis",
  "warm-product-language": "writing",
  "ada-chen": "entities",
  "river-studio": "entities",
  "maple-clinic": "entities"
};

const sourceUrlBySlug = {
  "source-summary-local-first-paper": "https://www.inkandswitch.com/essay/local-first/",
  "source-summary-privacy-report": "https://www.nngroup.com/articles/privacy/",
  "source-summary-usage-study": "https://www.nngroup.com/articles/first-time-user-experience/",
  "source-summary-founder-interview": "https://review.firstround.com/the-founder-led-sales-playbook-for-early-stage-startups/",
  "article-calm-software": "https://craigmod.com/essays/calm_technology/",
  "book-slow-product": "https://basecamp.com/shapeup"
};

function slugify(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(daysAgo) {
  const date = new Date(baseDate.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function formatTimestamp(daysAgo, minutesOffset = 0) {
  return baseDate.getTime() - daysAgo * 24 * 60 * 60 * 1000 + minutesOffset * 60 * 1000;
}

function uuidFromNumber(value) {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

const notes = [
  ["Founder OS", "concept", ["founder", "systems"], "A lightweight operating system for the week that keeps planning, feedback, and recovery in one place.", ["Weekly Review Rhythm", "Ship Room Routine", "Activation Metrics", "Product Council"]],
  ["Trellis Roadmap", "concept", ["product", "roadmap"], "A running map of the few bets that compound the product instead of fragmenting it.", ["Notes From Chats", "Trust Signals", "Edge Function Retries", "Product Council"]],
  ["Warm Product Language", "concept", ["writing", "ux"], "Copy should feel calm, specific, and steady enough that the product earns trust before it asks for effort.", ["Assistant Voice And Tone", "Doc Style Guide", "Trust Signals", "Article Calm Software"]],
  ["Ship Room Routine", "concept", ["shipping", "cadence"], "Small launch rituals keep the team moving without manufacturing urgency.", ["Launch Week Checklist", "Weekly Review Rhythm", "Founder OS", "Trust Signals"]],
  ["Customer Advisory Cadence", "concept", ["research", "customers"], "A repeatable schedule for hearing from serious users before roadmap decisions harden.", ["Field Notes Design Partners", "Voice Of Customer April", "Activation Metrics", "Office Hours Format"]],
  ["Pricing Notes", "concept", ["pricing", "growth"], "Packaging should mirror value moments the product already proves instead of forcing artificial tiers.", ["Activation Metrics", "Trust Signals", "Voice Of Customer April", "Synthesis Activation And Trust"]],
  ["Activation Metrics", "concept", ["growth", "metrics"], "The app earns its keep when first value is visible, repeatable, and easy to explain back to a teammate.", ["Onboarding Friction", "Retention Loop", "Pricing Notes", "Synthesis Activation And Trust"]],
  ["Onboarding Friction", "concept", ["onboarding", "ux"], "Cold-start friction usually hides inside too many decisions in the first five minutes.", ["Activation Metrics", "Meeting Distillation", "Trust Signals", "Launch Week Checklist"]],
  ["Retention Loop", "concept", ["retention", "product"], "People come back when each interaction leaves behind structure they can reuse later.", ["Activation Metrics", "Ambient Capture", "Graph Reading Ritual", "Founder OS"]],
  ["Office Hours Format", "concept", ["support", "research"], "Office hours work best when every conversation leaves behind patterns worth folding into the product.", ["Customer Advisory Cadence", "Support Inbox Patterns", "Voice Of Customer April", "Field Notes Design Partners"]],
  ["Weekly Review Rhythm", "concept", ["planning", "systems"], "Weekly review is the bridge between the founder's intuition and the team's shared plan.", ["Founder OS", "Research Queue", "Product Council", "Ship Room Routine"]],
  ["Research Queue", "concept", ["research", "reading"], "A queue is useful only if it narrows into the next few questions the team actually needs answered.", ["Reading List Systems", "Citation Hygiene", "Local First Principles", "Weekly Review Rhythm"]],
  ["Citation Hygiene", "concept", ["research", "writing"], "Source notes should preserve enough provenance that later synthesis does not feel like folklore.", ["Research Queue", "Source Summary Local First Paper", "Doc Style Guide", "Source Summary Privacy Report"]],
  ["Local First Principles", "concept", ["architecture", "local-first"], "Local-first means the product remains useful when the network is gone and transparent when it returns.", ["Vault Layout", "Ambient Capture", "Source Summary Privacy Report", "Source Summary Local First Paper"]],
  ["Ambient Capture", "concept", ["capture", "workflow"], "Capture should feel quieter than opening a blank page but richer than dropping raw transcripts into a folder.", ["Meeting Distillation", "Retention Loop", "Founder OS", "Vault Layout"]],
  ["Meeting Distillation", "concept", ["meetings", "notes"], "Conversation becomes useful when the residue is shorter than the meeting and easier to revisit than a recording.", ["Ambient Capture", "Support Inbox Patterns", "Onboarding Friction", "Notes From Chats"]],
  ["Support Inbox Patterns", "concept", ["support", "operations"], "A support inbox becomes strategic once similar requests are clustered into product signals instead of one-off answers.", ["Office Hours Format", "Synthesis Support Signals", "Voice Of Customer April", "Meeting Distillation"]],
  ["Launch Week Checklist", "concept", ["launch", "operations"], "Launches stay calm when the checklist protects support, documentation, and rollback paths as much as marketing.", ["Ship Room Routine", "Trust Signals", "Product Council", "Onboarding Friction"]],
  ["Field Notes Design Partners", "concept", ["customers", "research"], "Design partner notes work best as compact patterns, not exhaustive transcripts.", ["Customer Advisory Cadence", "Voice Of Customer April", "Ada Chen", "Maple Clinic"]],
  ["Voice Of Customer April", "concept", ["customers", "insights"], "April interviews kept repeating the same request: show compounding value earlier and explain it more plainly.", ["Pricing Notes", "Support Inbox Patterns", "Trust Signals", "Field Notes Design Partners"]],
  ["Doc Style Guide", "concept", ["writing", "documentation"], "Internal docs should read like a calm briefing rather than a brainstorm frozen in place.", ["Warm Product Language", "Assistant Voice And Tone", "Citation Hygiene", "Notes From Chats"]],
  ["Hiring Product Engineer", "concept", ["hiring", "team"], "The role needs taste for product edges, not just throughput on isolated tickets.", ["Product Council", "Trellis Roadmap", "River Studio", "Ada Chen"]],
  ["Product Council", "concept", ["planning", "team"], "A small council can keep strategy coherent if it narrows disagreements into explicit tradeoffs.", ["Founder OS", "Trellis Roadmap", "Hiring Product Engineer", "Launch Week Checklist"]],
  ["Assistant Voice And Tone", "concept", ["ux", "assistant"], "The assistant should sound observant, not overeager; helpful, not theatrical.", ["Warm Product Language", "Doc Style Guide", "Notes From Chats", "Trust Signals"]],
  ["Trust Signals", "concept", ["ux", "trust"], "Trust grows when the app makes state visible, handles failure calmly, and avoids pretending uncertainty is certainty.", ["Pricing Notes", "Activation Metrics", "Synthesis Activation And Trust", "Source Summary Privacy Report"]],
  ["Edge Function Retries", "concept", ["backend", "reliability"], "Retries need guardrails so intermittent failure does not turn into noisy duplicate work.", ["Supabase Usage Notes", "Trellis Roadmap", "Source Summary Usage Study", "Trust Signals"]],
  ["Supabase Usage Notes", "concept", ["backend", "supabase"], "Supabase is best used for identity, usage, and orchestration while the device keeps ownership of user knowledge.", ["Edge Function Retries", "Vault Layout", "Local First Principles", "Trellis Roadmap"]],
  ["Vault Layout", "concept", ["vault", "information-architecture"], "A vault stays navigable when the filesystem mirrors durable concepts, not every temporary conversation.", ["Local First Principles", "Graph Reading Ritual", "Notes From Chats", "Ambient Capture"]],
  ["Graph Reading Ritual", "concept", ["graph", "sensemaking"], "The graph is most useful as a reading surface for weak signals rather than a dashboard for vanity complexity.", ["Vault Layout", "Retention Loop", "Notes From Chats", "Reading List Systems"]],
  ["Reading List Systems", "concept", ["reading", "systems"], "Reading lists need pruning rules or they quietly become guilt inventories.", ["Research Queue", "Article Calm Software", "Book Slow Product", "Graph Reading Ritual"]],
  ["Book Slow Product", "source-summary", ["books", "product"], "A short summary of notes on patient product-building, selective scope, and respecting user attention.", ["Reading List Systems", "Founder OS", "Warm Product Language", "Product Council"]],
  ["Article Calm Software", "source-summary", ["articles", "ux"], "Highlights from an essay about software that signals steadiness through pace, wording, and visible state.", ["Warm Product Language", "Trust Signals", "Reading List Systems", "Assistant Voice And Tone"]],
  ["Source Summary Privacy Report", "source-summary", ["privacy", "research"], "Privacy report notes emphasizing explicit boundaries, local ownership, and predictable failure states.", ["Local First Principles", "Trust Signals", "Maple Clinic", "Citation Hygiene"]],
  ["Source Summary Usage Study", "source-summary", ["analytics", "research"], "Usage study excerpts on what makes users return after the first successful AI interaction.", ["Activation Metrics", "Edge Function Retries", "River Studio", "Synthesis Activation And Trust"]],
  ["Source Summary Local First Paper", "source-summary", ["local-first", "research"], "Research paper notes about latency, resilience, and the product trust created by data locality.", ["Local First Principles", "Vault Layout", "Citation Hygiene", "Supabase Usage Notes"]],
  ["Source Summary Founder Interview", "source-summary", ["founders", "research"], "A founder interview condensed into decisions about focus, cadence, and staying close to design partners.", ["Founder OS", "Product Council", "Ada Chen", "Hiring Product Engineer"]],
  ["Synthesis Activation And Trust", "synthesis", ["synthesis", "growth"], "Activation and trust move together: users repeat behavior when first value feels legible and safe.", ["Activation Metrics", "Trust Signals", "Source Summary Usage Study", "Pricing Notes"]],
  ["Notes From Chats", "synthesis", ["synthesis", "workflow"], "Chats become durable when the product turns moments of clarity into notes that are easy to re-enter later.", ["Trellis Roadmap", "Assistant Voice And Tone", "Vault Layout", "Meeting Distillation"]],
  ["Synthesis Support Signals", "synthesis", ["synthesis", "support"], "Support conversations become useful once they are compressed into a handful of recurring product signals.", ["Support Inbox Patterns", "Voice Of Customer April", "Trust Signals", "Office Hours Format"]],
  ["Ada Chen", "entity", ["people", "design-partner"], "Ada runs operations with unusually clear product instincts and tends to notice trust gaps before she names them directly.", ["Field Notes Design Partners", "Source Summary Founder Interview", "Hiring Product Engineer", "Customer Advisory Cadence"]],
  ["River Studio", "entity", ["customers", "agency"], "A small design agency using Trellis to keep project context from falling back into chat history alone.", ["Source Summary Usage Study", "Hiring Product Engineer", "Trust Signals", "Voice Of Customer April"]],
  ["Maple Clinic", "entity", ["customers", "healthcare"], "A clinic team evaluating how local-first note handling changes their comfort with AI-assisted knowledge tools.", ["Field Notes Design Partners", "Source Summary Privacy Report", "Trust Signals", "Local First Principles"]]
];

const rawSources = [
  ["founder-interview-transcript.md", "Founder Interview", "Reference: [First Round Review - founder-led sales playbook](https://review.firstround.com/the-founder-led-sales-playbook-for-early-stage-startups/).\n\nThe most useful line in this interview was not about selling harder. It was about keeping one promise visible long enough that customers can repeat it back in their own words. That maps closely to [[Founder OS]] and [[Product Council]] because both notes are really about protecting a narrow story from quarter-to-quarter drift.\n\nWorking takeaways:\n- Treat design partner conversations as evidence, not decoration.\n- Name the next quarter in one sentence before naming the project list.\n- Make the operating rhythm observable enough that new teammates can inherit it quickly.\n\nThis source is worth revisiting whenever the roadmap starts to widen faster than the team can explain it."],
  ["privacy-report-excerpts.md", "Privacy Report Excerpts", "Reference: [Nielsen Norman Group - Design for Privacy](https://www.nngroup.com/articles/privacy/).\n\nUsers trusted the product more when they could point to where data lived, what left the device, and what still worked offline. The strongest reactions were not about encryption jargon; they were about visible boundaries and predictable failure handling.\n\nRepeated patterns from the report:\n- People calm down when storage location is explicit.\n- Sync feels safer when it is legible, reversible, and not overly magical.\n- Permission language matters most when the app is about to cross a boundary.\n\nThe report repeatedly connected trust to predictability rather than branding. That is a useful lens for [[Trust Signals]], [[Local First Principles]], and the Maple Clinic notes."],
  ["usage-study-notes.md", "Usage Study Notes", "Reference: [Nielsen Norman Group - First-Time User Experience](https://www.nngroup.com/articles/first-time-user-experience/).\n\nRepeat usage rose when the second visit started from something the first visit left behind. Users were much more likely to return when they could open the app and immediately see a durable artifact: a note, a linked cluster, or a short summary that felt worth continuing.\n\nObserved behaviors:\n- Empty states created hesitation unless the app suggested one clear next action.\n- The graph became reassuring only after notes were dense enough to feel lived in.\n- People described the product as smart only after they could revisit the residue of prior chats.\n\nThis file is a good counterweight to feature-sprawl conversations because it keeps attention on repeatable value, not novelty."],
  ["local-first-paper-highlights.md", "Local-first Paper Highlights", "Reference: [Ink & Switch - Local-first software](https://www.inkandswitch.com/essay/local-first/).\n\nLocal latency changes product tone. Fast, resilient interactions feel less theatrical and more dependable. The paper's strongest contribution is not just the technical architecture; it is the argument that software feels more humane when the user's work remains available and responsive without asking permission from the network.\n\nHighlights worth carrying forward:\n- Local-first systems preserve ownership without forcing users to think like backup administrators.\n- Sync should be visible but not demanding.\n- Collaboration improves when the local copy is the default home of the work, not a cache of some remote original.\n\nThis source keeps sharpening [[Local First Principles]], [[Vault Layout]], and the product's calmer trust story."],
  ["design-partner-call-ada.md", "Ada Partner Call", "Ada wanted the app to explain what changed after a chat without forcing her to inspect each note manually.\n\nShe also preferred warmer, steadier interface language."],
  ["design-partner-call-maple.md", "Maple Clinic Call", "Maple Clinic cared about local storage boundaries first, then workflow speed.\n\nThe team said trust would depend on whether the product could fail gracefully when cloud services disappeared."],
  ["launch-week-retro.md", "Launch Week Retro", "Support volume was low, but confusion clustered around what counted as saved knowledge versus transient chat.\n\nThe next launch should explain the compounding loop earlier."],
  ["pricing-page-feedback.md", "Pricing Page Feedback", "Prospects responded best when pricing language connected directly to repeated value rather than model access alone.\n\nWords like durable, local, and compounding resonated more than premium."],
  ["support-roundup-march.md", "Support Roundup", "Most support questions mapped back to three themes: trust, onboarding clarity, and where notes live.\n\nThat makes support a strategic input to product planning rather than a cleanup task."],
  ["calm-software-clippings.md", "Calm Software Clippings", "Reference: [Craig Mod - Calm Technology](https://craigmod.com/essays/calm_technology/).\n\nCalm software avoids false urgency, makes state legible, and gives users a sense that the tool will still be useful tomorrow. The article framed restraint as a product feature, not an aesthetic flourish.\n\nUseful product translation:\n- Reduce performative loading states.\n- Make empty screens feel intentional instead of abandoned.\n- Prefer quiet confidence over busy reassurance.\n\nThis is a helpful companion to [[Warm Product Language]] and [[Trust Signals]]."]
];

const sessionBlueprints = [
  ["Pricing page rewrite", 171, "gpt-4.1-mini", [
    {
      role: "user",
      content:
        "I want the pricing page to sound less like we are selling models and more like we are selling compounding memory.",
      attachments: [
        {
          kind: "file",
          label: "Pricing Page Feedback",
          text:
            "Prospects responded best when pricing language connected directly to repeated value rather than model access alone.\n\nWords like durable, local, and compounding resonated more than premium."
        }
      ]
    },
    ["assistant", "Lead with durable value: every useful chat should leave behind notes, links, and a graph that feels more helpful over time. That lines up with [[Pricing Notes]] and [[Trust Signals]]."],
    ["user", "Can you tighten that into three page sections and keep the tone calm?"],
    ["assistant", "Yes. I would structure it as promise, proof, and boundaries: what compounds, how it stays local-first, and what remains visible when cloud features are unavailable."]
  ]],
  ["Founder retreat agenda", 160, "claude-3-5-haiku-latest", [
    ["user", "I need a two-day retreat agenda for product decisions that have been dragging."],
    ["assistant", "Anchor the retreat around [[Founder OS]], [[Product Council]], and [[Weekly Review Rhythm]]. Day one should narrow the next quarter's bets. Day two should test which rituals keep those bets alive."],
    ["user", "I also want a short prep memo for everyone."],
    ["assistant", "Frame the memo around open tensions, not polished answers. Ask each person to bring one decision, one risk, and one piece of design partner evidence."]
  ]],
  ["Support tags cleanup", 149, "gpt-4.1-mini", [
    ["user", "Support tickets keep piling up without enough structure. I need a calmer tagging scheme."],
    ["assistant", "Group tags around product signals instead of surfaces: onboarding, trust, and compounding value. That mirrors [[Support Inbox Patterns]] and [[Synthesis Support Signals]]."],
    ["user", "Can you suggest a weekly review loop for that?"],
    ["assistant", "Review the tags once a week, summarize the top three shifts, and route only those themes into roadmap discussion."]
  ]],
  ["Design partner follow-up", 138, "gpt-4.1-mini", [
    {
      role: "user",
      content: "I need a better follow-up note after today's design partner calls.",
      attachments: [
        {
          kind: "file",
          label: "Ada Partner Call",
          text:
            "Ada wanted the app to explain what changed after a chat without forcing her to inspect each note manually.\n\nShe also preferred warmer, steadier interface language."
        },
        {
          kind: "file",
          label: "Maple Clinic Call",
          text:
            "Maple Clinic cared about local storage boundaries first, then workflow speed.\n\nThe team said trust would depend on whether the product could fail gracefully when cloud services disappeared."
        }
      ]
    },
    ["assistant", "Summarize each call into one sharp need, one trust concern, and one workflow moment. That keeps [[Field Notes Design Partners]] compact and comparable."],
    ["user", "Ada and Maple both cared about boundaries, but in different language."],
    ["assistant", "Name the shared theme as trust and keep the phrasing separate underneath so you do not flatten the nuance too early."]
  ]],
  ["Onboarding checklist", 128, "gpt-4.1-mini", [
    ["user", "New users still stare at an empty app. I need a first-run checklist that does not feel technical."],
    ["assistant", "Keep it to three visible steps: choose a vault, start a first chat, and open the first generated note. That directly addresses [[Onboarding Friction]]."],
    ["user", "What language would you use?"],
    ["assistant", "Use steady verbs: choose, ask, open. Avoid setup-heavy language unless a failure state requires more detail."]
  ]],
  ["Notes from chats", 118, "claude-3-7-sonnet-latest", [
    ["user", "I keep saying notes from chats compound, but the product still explains it awkwardly."],
    ["assistant", "Show the sequence plainly: chat, extract, link, revisit. [[Notes From Chats]] should feel like a working loop, not a hidden feature."],
    ["user", "What should the graph say in that frame?"],
    ["assistant", "That it is a reading surface for the growing body of notes, not just a map for its own sake."]
  ]],
  ["Local-first pitch", 108, "gpt-4.1-mini", [
    ["user", "I need a short local-first pitch that feels practical, not ideological."],
    ["assistant", "Describe what the user keeps: local chats, local notes, and usefulness during outages. That is the strongest expression of [[Local First Principles]]."],
    ["user", "What should I avoid saying?"],
    ["assistant", "Avoid implying the cloud disappears. The strength is that the local layer remains trustworthy even when the cloud is unavailable."]
  ]],
  ["Usage limits wording", 97, "gpt-4.1-mini", [
    ["user", "How should we explain usage limits without making the product feel stingy?"],
    ["assistant", "Tie limits to predictable operating costs and keep the upgrade language anchored in value moments, not fear. [[Pricing Notes]] and [[Trust Signals]] both point that way."],
    ["user", "Can I say premium models in the first sentence?"],
    ["assistant", "Only after you've reminded the reader what the product helps them keep."]
  ]],
  ["Weekly review template", 88, "claude-3-5-haiku-latest", [
    ["user", "I want a tighter weekly review template for the team."],
    ["assistant", "Use four blocks: what compounded, where users hesitated, what changed in the graph, and what gets dropped next week. That links [[Weekly Review Rhythm]] to [[Retention Loop]]."],
    ["user", "Should support sit inside that or separate?"],
    ["assistant", "Keep support inside as evidence, not as its own silo."]
  ]],
  ["Hiring brief sync", 77, "gpt-4.1-mini", [
    ["user", "I'm hiring a product engineer and the brief still sounds generic."],
    ["assistant", "Name the actual edge: someone who can tighten product language, reason about local-first architecture, and turn user signals into implementation decisions. [[Hiring Product Engineer]] needs that specificity."],
    ["user", "Should I mention design taste directly?"],
    ["assistant", "Yes, but tie it to concrete responsibilities like onboarding, failure states, and note workflows."]
  ]],
  ["Launch week retro", 66, "gpt-4.1-mini", [
    {
      role: "user",
      content: "Give me a short retro outline after launch week.",
      attachments: [
        {
          kind: "file",
          label: "Launch Week Retro",
          text:
            "Support volume was low, but confusion clustered around what counted as saved knowledge versus transient chat.\n\nThe next launch should explain the compounding loop earlier."
        }
      ]
    },
    ["assistant", "Start with what users understood immediately, where support questions clustered, and what the team had to explain repeatedly. [[Launch Week Checklist]] and [[Support Inbox Patterns]] are the right anchors."],
    ["user", "Can we turn that into next sprint input?"],
    ["assistant", "Yes. Translate each repeated explanation into one product or copy decision."]
  ]],
  ["Meeting note capture", 55, "claude-3-5-haiku-latest", [
    ["user", "I want meeting notes to become more reusable. Right now they just pile up."],
    ["assistant", "Shorten the residue. Pull out decisions, tensions, and follow-up notes instead of preserving full transcripts. [[Meeting Distillation]] and [[Ambient Capture]] should drive the pattern."],
    ["user", "What if I still want access to the raw material?"],
    ["assistant", "Keep raw material in the vault, but make the working note the obvious entry point."]
  ]],
  ["Trust signals audit", 43, "gpt-4.1-mini", [
    ["user", "Help me audit the product for trust signals before the next release."],
    ["assistant", "Review every place the app touches uncertainty: loading, empty states, cloud failures, and where notes are written. [[Trust Signals]] should connect those moments into one standard."],
    ["user", "What's the quickest pass?"],
    ["assistant", "Look for places where the app implies progress without showing what changed."]
  ]],
  ["Graph reading habits", 32, "gpt-4.1-mini", [
    ["user", "People either love the graph or ignore it. I need a clearer framing."],
    ["assistant", "Position it as a reading ritual for connected ideas, not a universal control panel. That is the core of [[Graph Reading Ritual]]."],
    ["user", "What should the empty state say?"],
    ["assistant", "Invite the user to start with one note cluster or recent session, not the whole graph at once."]
  ]],
  ["River Studio debrief", 21, "claude-sonnet-4-20250514", [
    ["user", "River Studio liked the product but worried about where context lives between projects."],
    ["assistant", "That suggests we should sharpen the vault story and explain project separation more clearly. [[River Studio]] connects nicely to [[Vault Layout]] and [[Trust Signals]]."],
    ["user", "Anything else worth logging?"],
    ["assistant", "Yes: they treated repeatable recovery of context as the real wow moment, not the model output itself."],
    ["user", "They also asked whether each client could have its own vault without losing the cross-project references the team relies on."],
    ["assistant", "Capture that as a structural tension: separation by default, intentional bridges when the work genuinely overlaps. [[Vault Layout]] should explain the boundary, while [[River Studio]] can hold the agency-specific examples."],
    ["user", "What's the cleanest follow-up question for the next call?"],
    ["assistant", "Ask them to walk through one real handoff: where context currently lives, when it gets lost, and what they would need to trust a vault-per-client setup. That will surface whether the problem is navigation, permissions, or retrieval."]
  ]],
  ["Maple Clinic interview", 13, "gpt-4.1-mini", [
    {
      role: "user",
      content: "Maple Clinic reacted strongly to the local-first story. I want a succinct readout.",
      attachments: [
        {
          kind: "file",
          label: "Maple Clinic Call",
          text:
            "Maple Clinic cared about local storage boundaries first, then workflow speed.\n\nThe team said trust would depend on whether the product could fail gracefully when cloud services disappeared."
        }
      ]
    },
    ["assistant", "Record the priority order clearly: local storage boundaries first, offline usefulness second, workflow speed third. [[Maple Clinic]] and [[Source Summary Privacy Report]] should carry that thread."],
    ["user", "Should the product copy mention clinics specifically?"],
    ["assistant", "Not yet. Keep the copy general and let the case notes remain specific."],
    ["user", "They kept asking what still works if cloud models are down for the day."],
    ["assistant", "That is worth highlighting because it turns local-first from philosophy into an operational promise. Tie the readout to note access, search, and the ability to continue organizing the vault even when generation pauses."],
    ["user", "Should I capture the compliance angle too or is that too early?"],
    ["assistant", "Capture it as an emerging theme, not a product claim. Say that explicit storage boundaries lowered anxiety, while formal compliance questions still need separate validation."]
  ]],
  ["Office hours plan", 7, "gpt-4.1-mini", [
    ["user", "I want office hours to produce more than scattered follow-ups."],
    ["assistant", "Ask one product question each week, log patterns in the same format, and connect the output back into [[Office Hours Format]] and [[Support Inbox Patterns]]."],
    ["user", "What's the smallest template?"],
    ["assistant", "Theme, quote, friction, next decision."],
    ["user", "I also want the notes to roll up into something the team can scan in five minutes."],
    ["assistant", "Then standardize the residue. End each session with one sentence on the user's goal, one quote, one friction point, and the next decision it informs. That gives [[Office Hours Format]] a repeatable shape."],
    ["user", "Could that feed the weekly review automatically?"],
    ["assistant", "Yes, if the format stays consistent. Treat office hours as a lightweight evidence stream that lands inside [[Weekly Review Rhythm]] instead of becoming a separate reporting ritual."]
  ]],
  ["Roadmap trimming", 3, "claude-sonnet-4-20250514", [
    ["user", "The roadmap is sprawling again. Help me trim it to three bets."],
    ["assistant", "Bias toward compounding loops: stronger first-run clarity, better note extraction, and clearer trust boundaries. That keeps [[Trellis Roadmap]] aligned with [[Activation Metrics]] and [[Trust Signals]]."],
    ["user", "What do I defer?"],
    ["assistant", "Anything that adds surface area without making the core loop easier to understand or revisit."],
    ["user", "I keep wanting to add collaboration polish and more graph controls because they feel strategic."],
    ["assistant", "They may be strategic later, but right now they widen the product before the core loop is dependable. Ask whether each idea helps a new user move from first chat to a revisitable note with more confidence."],
    ["user", "Can you restate the three bets as outcomes instead of features?"],
    ["assistant", "Yes: new users understand what to do within minutes, important conversations turn into useful notes without cleanup, and people trust where their context lives when cloud features or providers are unavailable."]
  ]]
];

function buildNoteContent(title, summary, links) {
  const introLinks = links.slice(0, 3).map((link) => `[[${link}]]`).join(", ");
  const relatedList = links.map((link) => `- [[${link}]]`).join("\n");

  return [
    `${summary} It keeps resurfacing alongside ${introLinks}.`,
    "## Working notes",
    `The useful pattern here is to keep the note compact enough to revisit quickly, while still giving the next session enough structure to build on without restating the whole backstory.`,
    "## Related",
    relatedList
  ].join("\n\n");
}

function buildDetailedNoteContent(note) {
  const relatedList = note.links.map((link) => `- [[${link}]]`).join("\n");

  const longFormBySlug = {
    "founder-os": [
      `${note.summary} It keeps resurfacing alongside [[Weekly Review Rhythm]], [[Ship Room Routine]], and [[Activation Metrics]].`,
      "## Why this note exists",
      "The team kept inventing slightly different planning rituals every month, which made the product story feel more chaotic than it really was. This note became the stable reference for the weekly operating loop: decide the one visible promise, collect user evidence against it, and keep enough recovery time on the calendar that the pace stays believable.",
      "## Current shape",
      "Right now the operating system is intentionally small:",
      "- Monday: review new notes, support patterns, and unresolved product questions.",
      "- Midweek: ship the smallest thing that makes the core loop easier to understand.",
      "- Friday: write a short memo about what compounded, what confused users, and what gets dropped next.",
      "",
      "That structure owes a lot to [Shape Up](https://basecamp.com/shapeup) and to the quieter local-first stance in [Ink & Switch's essay on local-first software](https://www.inkandswitch.com/essay/local-first/): make progress tangible, keep ownership close to the team, and avoid theatrical coordination overhead.",
      "## Open tensions",
      "The main tension is that the product can generate lots of interesting material very quickly, while the team can only operationalize a few ideas per week. Founder OS is the filter, not the archive. If a note does not help with roadmap focus, customer understanding, or recovery, it probably belongs elsewhere in the vault.",
      "## Related",
      relatedList
    ].join("\n\n"),
    "trellis-roadmap": [
      `${note.summary} It keeps resurfacing alongside [[Notes From Chats]], [[Trust Signals]], and [[Edge Function Retries]].`,
      "## Q2 bets",
      "The roadmap has been narrowed down to three bets that visibly reinforce each other instead of scattering attention:",
      "- Make first-run value legible within the first session.",
      "- Make extracted notes easier to trust, edit, and revisit.",
      "- Make local-versus-cloud boundaries obvious enough that users stop asking where their data lives.",
      "",
      "Everything else currently sits in the parking lot unless it strengthens one of those loops.",
      "## Why this framing is holding",
      "The strongest design partner feedback has been surprisingly consistent: people do not need more surfaces, they need a clearer sense of what the product keeps for them over time. That pushes the roadmap toward compounding workflows rather than feature variety.",
      "## External references",
      "Useful outside reads for this note:",
      "- [First Round Review on founder-led sales](https://review.firstround.com/the-founder-led-sales-playbook-for-early-stage-startups/) for how to keep the product promise narratable.",
      "- [NN/g on first-time UX](https://www.nngroup.com/articles/first-time-user-experience/) for why early clarity matters more than depth.",
      "- [Ink & Switch on local-first software](https://www.inkandswitch.com/essay/local-first/) for the trust argument behind keeping the vault local.",
      "## Related",
      relatedList
    ].join("\n\n"),
    "notes-from-chats": [
      `${note.summary} It keeps resurfacing alongside [[Trellis Roadmap]], [[Assistant Voice And Tone]], and [[Vault Layout]].`,
      "## Working loop",
      "The useful sequence is simple enough that it should be visible in the product itself:",
      "1. A chat produces one or two moments that feel sharper than the rest.",
      "2. Extraction turns those moments into editable note drafts.",
      "3. The user links, trims, or tags the note until it belongs in the vault.",
      "4. A later session starts from that note instead of from a blank box.",
      "",
      "The important thing is not that every chat becomes a note. It is that the good ones leave behind residue that the user can re-enter quickly.",
      "## Product implication",
      "The preview vault should show this compounding loop clearly: some notes are short, some are longer synthesis pieces, some point to raw files, and some carry outside sources. That mix is what makes the graph and wiki feel earned rather than auto-generated.",
      "## External references",
      "This note pairs well with [NN/g's work on first-time user experience](https://www.nngroup.com/articles/first-time-user-experience/) and with [Craig Mod's writing on calm technology](https://craigmod.com/essays/calm_technology/): one explains why the second visit matters, the other explains why the product should feel steady when users come back.",
      "## Related",
      relatedList
    ].join("\n\n"),
    "voice-of-customer-april": [
      `${note.summary} It keeps resurfacing alongside [[Pricing Notes]], [[Support Inbox Patterns]], and [[Trust Signals]].`,
      "## Repeated themes",
      "- People wanted the app to show what was saved after a chat without making them inspect every note manually.",
      "- The phrase local-first landed best when paired with a concrete example of what still works offline.",
      "- Several users liked the graph more after the wiki had enough density to feel lived in.",
      "",
      "Representative language from calls:",
      '- "I need to know what stayed with the app after the conversation ended."',
      '- "Show me the note, not just the answer."',
      '- "If the cloud goes away for a bit, I still want the vault to make sense."',
      "## What changed after synthesis",
      "These calls pushed the roadmap away from decorative AI framing and toward clearer state transitions: chat becomes note, note links to prior work, the graph reflects the growing body of knowledge, and the vault folder structure mirrors durable concepts instead of temporary projects.",
      "## Related",
      relatedList
    ].join("\n\n"),
    "source-summary-local-first-paper": [
      `${note.summary} It keeps resurfacing alongside [[Local First Principles]], [[Vault Layout]], and [[Citation Hygiene]].`,
      "## Source",
      "Primary reference: [Ink & Switch - Local-first software](https://www.inkandswitch.com/essay/local-first/).",
      "## Summary",
      "The paper argues that modern software should give users the convenience they expect from cloud tools without giving up the ownership, latency, and resilience of local software. The strongest product takeaway is emotional as much as technical: local responsiveness changes the perceived temperament of the tool.",
      "## Why it matters here",
      "This source is one of the clearest justifications for Trellis keeping chats and notes useful on-device. The user should feel that the app belongs to them first, with cloud orchestration acting as a helpful extension rather than a hidden dependency.",
      "## Notes worth keeping",
      "- Local state should feel like the canonical home of user work, not a cache.",
      "- Sync can be sophisticated under the hood while still reading as calm and legible in the UI.",
      "- Local ownership becomes a trust signal when cloud features inevitably fail or slow down.",
      "## Related",
      relatedList
    ].join("\n\n"),
    "source-summary-privacy-report": [
      `${note.summary} It keeps resurfacing alongside [[Local First Principles]], [[Trust Signals]], and [[Maple Clinic]].`,
      "## Source",
      "Reference note based on [Nielsen Norman Group - Design for Privacy](https://www.nngroup.com/articles/privacy/).",
      "## Summary",
      "The most actionable thread in the report is that users rarely distinguish between privacy, security, and general trust in the interface. In practice, they read all three through visible boundaries: where the data lives, when it leaves, and whether the product behaves predictably when something goes wrong.",
      "## Implications for preview data",
      "The shipped preview should include enough notes, files, and source references that people can inspect the vault like a real workspace. That makes the local-first promise more believable than an empty demo account would.",
      "## Notes worth keeping",
      "- Permission copy should describe consequences, not policy categories.",
      "- Boundary crossings should be explicit in both copy and interaction design.",
      "- Failure states often communicate trust more strongly than success states.",
      "## Related",
      relatedList
    ].join("\n\n")
  };

  return longFormBySlug[note.slug] ?? buildNoteContent(note.title, note.summary, note.links);
}

function buildFrontmatter(note, created, updated) {
  const lines = [
    "---",
    `title: ${note.title}`,
    `created: "${created}"`,
    `updated: "${updated}"`,
    `sources: ${note.type === "source-summary" ? 1 : note.type === "synthesis" ? 4 : 2}`,
    `tags: [${note.tags.join(", ")}]`,
    `type: ${note.type}`
  ];

  if (note.type === "source-summary") {
    lines.push(`url: ${sourceUrlBySlug[note.slug] ?? `https://preview.trellis.app/sources/${note.slug}`}`);
  }

  lines.push("---", "");
  return lines.join("\n");
}

function generateNotes() {
  return notes.map(([title, type, tags, summary, links], index) => {
    const createdDaysAgo = Math.max(12, 178 - index * 4);
    const updatedDaysAgo = Math.max(1, createdDaysAgo - (18 + (index % 5) * 7));
    const slug = slugify(title);

    return {
      title,
      slug,
      folderPath: noteFolderBySlug[slug] ?? "",
      type,
      tags,
      created: formatDate(createdDaysAgo),
      updated: formatDate(updatedDaysAgo),
      summary,
      links,
      content: buildDetailedNoteContent({ title, slug, summary, links })
    };
  });
}

function generateSessions() {
  let messageCounter = 1000;

  return sessionBlueprints.map(([title, daysAgo, model, transcript], sessionIndex) => {
    const sessionId = uuidFromNumber(sessionIndex + 1);
    const createdAt = formatTimestamp(daysAgo);
    const messages = transcript.map((entry, messageIndex) => {
      const turn = Array.isArray(entry)
        ? { role: entry[0], content: entry[1] }
        : entry;

      return {
        id: uuidFromNumber(messageCounter++),
        sessionId,
        role: turn.role,
        content: turn.content,
        createdAt: createdAt + messageIndex * 90_000,
        tokens: turn.role === "assistant" ? 320 + messageIndex * 24 : null,
        ...(turn.attachments && turn.attachments.length > 0
          ? { attachments: turn.attachments }
          : {})
      };
    });

    return {
      session: {
        id: sessionId,
        title,
        createdAt,
        updatedAt: messages.at(-1).createdAt,
        model,
        vaultId: previewVaultId
      },
      messages
    };
  });
}

function generateStandardPreviewSeed() {
  fs.rmSync(seedDir, { recursive: true, force: true });
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const generatedNotes = generateNotes();
  const generatedSessions = generateSessions();

  for (const note of generatedNotes) {
    const file = `${buildFrontmatter(note, note.created, note.updated)}${note.content.trim()}\n`;
    writeFile(path.join(wikiDir, note.folderPath, `${note.slug}.md`), file);
  }

  for (const [fileName, heading, body] of rawSources) {
    writeFile(path.join(rawDir, fileName), `# ${heading}\n\n${body.trim()}\n`);
  }

  const dbFixture = {
    sessions: generatedSessions.map((item) => item.session),
    messages: generatedSessions.flatMap((item) => item.messages)
  };

  writeFile(
    path.join(seedDir, "manifest.json"),
    `${JSON.stringify(
        {
        version: "preview-v4",
        vaultName: "Preview Vault",
        vaultFolder: "vault",
        databaseFile: "db.json"
      },
      null,
      2
    )}\n`
  );
  writeFile(path.join(seedDir, "db.json"), `${JSON.stringify(dbFixture, null, 2)}\n`);

  console.log(`Generated preview seed in ${seedDir}`);
  console.log(`Notes: ${generatedNotes.length}`);
  console.log(`Raw sources: ${rawSources.length}`);
  console.log(`Sessions: ${generatedSessions.length}`);
}

const heavyPreviewVaultId = "preview-heavy-main-vault";
const heavyLedgerFolders = ["bulk", "research", "playbooks", "writing", "operations", "synthesis"];

/** Modulus for `cluster-*` tags and link topology (must match tag suffix in `generateHeavyNotes`). */
const HEAVY_CLUSTER_MOD = 18;

function ledgerNoteTitle(oneBasedIndex) {
  return `Ledger Note ${String(oneBasedIndex).padStart(4, "0")}`;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildHeavyClusterPools(total) {
  const pools = Array.from({ length: HEAVY_CLUSTER_MOD }, () => []);
  for (let j = 1; j <= total; j += 1) {
    pools[j % HEAVY_CLUSTER_MOD].push(j);
  }
  return pools;
}

/**
 * Prefer links inside the same tag cluster (indices ≡ i (mod HEAVY_CLUSTER_MOD)) so the graph
 * forms topic-local clumps, plus one deterministic bridge into another cluster so components stay connected.
 * Replaces fixed long-step offsets that produced a uniform "one cloud" circulant graph.
 */
function linkTitlesForLedger(oneBasedIndex, total, pools) {
  const c = oneBasedIndex % HEAVY_CLUSTER_MOD;
  const pool = pools[c].filter((j) => j !== oneBasedIndex);
  const rng = mulberry32(0x9e47 + oneBasedIndex * 16_661);

  const indices = [];
  if (oneBasedIndex > HEAVY_CLUSTER_MOD) {
    indices.push(oneBasedIndex - HEAVY_CLUSTER_MOD);
  }
  if (oneBasedIndex + HEAVY_CLUSTER_MOD <= total) {
    indices.push(oneBasedIndex + HEAVY_CLUSTER_MOD);
  }

  const extras = pool.filter((j) => !indices.includes(j));
  while (indices.length < 3 && extras.length > 0) {
    const pick = Math.floor(rng() * extras.length);
    indices.push(extras[pick]);
    extras.splice(pick, 1);
  }

  const bridgeCluster = (c + 7) % HEAVY_CLUSTER_MOD;
  const bridgePool = pools[bridgeCluster];
  if (bridgePool.length > 0) {
    indices.push(bridgePool[oneBasedIndex % bridgePool.length]);
  }

  while (indices.length < 4 && extras.length > 0) {
    const pick = Math.floor(rng() * extras.length);
    indices.push(extras[pick]);
    extras.splice(pick, 1);
  }

  const unique = [...new Set(indices)].slice(0, 4);
  return unique.map((j) => ledgerNoteTitle(j));
}

function buildHeavyLedgerContent(title, links, oneBasedIndex) {
  const related = links.map((t) => `- [[${t}]]`).join("\n");
  const bridge = links[0] ?? title;

  return [
    `Working memo ${oneBasedIndex} in a long-running vault. The graph stays navigable when each note stays small but points to a few stable neighbors like [[${bridge}]].`,
    "## Context",
    "This entry simulates months of steady capture: meetings, research clippings, and half-finished decisions that still need a home.",
    "## Decisions",
    "- Keep the note short enough to scan in under a minute.",
    "- Prefer linking forward to the next related memo rather than duplicating paragraphs.",
    "- When in doubt, connect back to one anchor concept so the graph does not sprawl without backbone.",
    "## Related",
    related
  ].join("\n\n");
}

function buildHeavyFrontmatter(note) {
  const lines = [
    "---",
    `title: ${note.title}`,
    `created: "${note.created}"`,
    `updated: "${note.updated}"`,
    `sources: ${2 + (note.oneBasedIndex % 4)}`,
    `tags: [${note.tags.join(", ")}]`,
    `type: ${note.type}`,
    "---",
    ""
  ];
  return lines.join("\n");
}

function generateHeavyNotes(count) {
  const clusterPools = buildHeavyClusterPools(count);
  const notes = [];
  for (let i = 1; i <= count; i += 1) {
    const createdDaysAgo = Math.max(8, 520 - (i % 160) * 3);
    const updatedDaysAgo = Math.max(1, createdDaysAgo - (12 + (i % 9) * 5));
    const folder = heavyLedgerFolders[i % heavyLedgerFolders.length];
    const links = linkTitlesForLedger(i, count, clusterPools);
    const title = ledgerNoteTitle(i);
    const type = i % 23 === 0 ? "synthesis" : "concept";
    // Topic cluster first so graph node coloring and tag-overlap edge weights reflect real groupings.
    const tags = [`cluster-${i % HEAVY_CLUSTER_MOD}`, "ledger", `wave-${i % 7}`];

    notes.push({
      title,
      slug: slugify(title),
      folderPath: folder,
      type,
      tags,
      created: formatDate(createdDaysAgo),
      updated: formatDate(updatedDaysAgo),
      oneBasedIndex: i,
      content: buildHeavyLedgerContent(title, links, i)
    });
  }
  return notes;
}

const heavySessionTitleTemplates = [
  "Quarterly planning deep dive",
  "Support theme retro",
  "Design partner synthesis",
  "Graph performance review",
  "Onboarding narrative workshop",
  "Vault IA critique",
  "Retention metrics debate",
  "Local-first messaging pass",
  "Office hours roundup",
  "Hiring loop retro",
  "Roadmap trimming session",
  "Customer advisory readout",
  "Weekly review extended",
  "Incident response dry run",
  "Pricing copy critique",
  "Research queue triage",
  "Meeting capture standards",
  "Trust copy audit",
  "Assistant tone review",
  "Extraction quality pass",
  "Cross-team sync",
  "Field notes consolidation",
  "Launch checklist walkthrough",
  "Usage limits language",
  "BYOK onboarding notes",
  "Graph clustering experiment",
  "Note density check-in",
  "Search relevance review",
  "Citation hygiene working group",
  "Ambient capture patterns",
  "Weekly customer quotes",
  "Product council prep",
  "Ship room retrospective",
  "Retention interview synthesis",
  "Privacy boundary review",
  "Raw capture cleanup",
  "Synthesis backlog grooming",
  "Executive summary draft",
  "Investor narrative polish",
  "Internal demo feedback",
  "Beta feedback triage",
  "Long-horizon roadmap stress test",
  "Multi-vault navigation review",
  "Performance profiling notes",
  "Heavy preview validation chat"
];

const heavyModels = [
  "gpt-4.1-mini",
  "claude-3-5-haiku-latest",
  "claude-3-7-sonnet-latest",
  "claude-sonnet-4-20250514"
];

function generateHeavySessions(ledgerCount) {
  let messageCounter = 3_000_000;
  const rng = mulberry32(0x4b1d);

  return heavySessionTitleTemplates.map((title, sessionIndex) => {
    const daysAgo = 640 - sessionIndex * 14;
    const sessionId = uuidFromNumber(12_000 + sessionIndex);
    const createdAt = formatTimestamp(daysAgo);
    const model = heavyModels[sessionIndex % heavyModels.length];
    const turnCount = 14 + (sessionIndex % 11) * 2;

    const messages = [];
    for (let t = 0; t < turnCount; t += 1) {
      const isUser = t % 2 === 0;
      const linkA = ledgerNoteTitle(1 + Math.floor(rng() * ledgerCount));
      const linkB = ledgerNoteTitle(1 + Math.floor(rng() * ledgerCount));

      let content;
      if (isUser) {
        content = [
          `Session ${sessionIndex + 1} turn ${t + 1}: I am trying to keep long-running context manageable.`,
          `Can we relate this back to ${linkA} and ${linkB} without duplicating the whole history in every reply?`
        ].join("\n\n");
      } else {
        const block = [
          `Yes. Treat the vault as the canonical memory and keep chat turns short enough to scan.`,
          `The pattern that scales is: name the decision, point to [[${linkA}]] for precedent, and use [[${linkB}]] as the next follow-up.`,
          `If the user has hundreds of notes, interlinking matters more than length. Prefer four solid links over twenty paragraphs.`,
          `When the graph is dense, retrieval should feel like moving between rooms, not rereading a novel.`,
          `For stress testing, repeat the same navigation pattern until the UI stays calm: open list, search, open note, follow link, return.`,
          `If something feels slow, it is usually because the UI is doing too much work per keystroke, not because markdown is inherently heavy.`
        ];
        const repeat = 2 + (sessionIndex % 4);
        content = Array.from({ length: repeat }, (_, k) => `${block[k % block.length]} (Pass ${k + 1})`).join(
          "\n\n"
        );
      }

      messages.push({
        id: uuidFromNumber(messageCounter++),
        sessionId,
        role: isUser ? "user" : "assistant",
        content,
        createdAt: createdAt + t * 95_000,
        tokens: isUser ? null : 900 + t * 40 + sessionIndex * 6
      });
    }

    return {
      session: {
        id: sessionId,
        title,
        createdAt,
        updatedAt: messages.at(-1).createdAt,
        model,
        vaultId: heavyPreviewVaultId
      },
      messages
    };
  });
}

function generateHeavyPreviewSeed() {
  const heavySeedDir = fromRepoRoot("fixtures", "preview-heavy-seed");
  const heavyVaultDir = path.join(heavySeedDir, "vault");
  const heavyWikiDir = path.join(heavyVaultDir, "wiki");
  const heavyRawDir = path.join(heavyVaultDir, "raw");

  fs.rmSync(heavySeedDir, { recursive: true, force: true });
  fs.mkdirSync(heavyWikiDir, { recursive: true });
  fs.mkdirSync(heavyRawDir, { recursive: true });

  const ledgerCount = 750;
  const heavyNotes = generateHeavyNotes(ledgerCount);
  for (const note of heavyNotes) {
    const file = `${buildHeavyFrontmatter(note)}${note.content.trim()}\n`;
    writeFile(path.join(heavyWikiDir, note.folderPath, `${note.slug}.md`), file);
  }

  for (const [fileName, heading, body] of rawSources) {
    writeFile(path.join(heavyRawDir, fileName), `# ${heading}\n\n${body.trim()}\n`);
  }

  const heavySessions = generateHeavySessions(ledgerCount);
  const dbFixture = {
    sessions: heavySessions.map((item) => item.session),
    messages: heavySessions.flatMap((item) => item.messages)
  };

  writeFile(
    path.join(heavySeedDir, "manifest.json"),
    `${JSON.stringify(
      {
        version: "preview-heavy-v1",
        vaultName: "Heavy Preview Vault",
        vaultFolder: "vault",
        databaseFile: "db.json"
      },
      null,
      2
    )}\n`
  );
  writeFile(path.join(heavySeedDir, "db.json"), `${JSON.stringify(dbFixture, null, 2)}\n`);

  console.log(`Generated heavy preview seed in ${heavySeedDir}`);
  console.log(`Notes: ${heavyNotes.length}`);
  console.log(`Raw sources: ${rawSources.length}`);
  console.log(`Sessions: ${heavySessions.length}`);
  console.log(`Messages: ${dbFixture.messages.length}`);
}

const mode = process.argv[2];
if (mode === "heavy") {
  generateHeavyPreviewSeed();
} else {
  generateStandardPreviewSeed();
}
