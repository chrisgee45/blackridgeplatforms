import { db } from "./db";
import { outreachCampaigns, campaignSteps } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const CAMPAIGN_A_NAME = "Campaign A - Website Audit";

const TRAVIS_SIGNATURE = `Travis
Outreach Lead
BlackRidge Platforms`;

const STEPS = [
  {
    stepNumber: 1,
    delayDays: 0,
    templateSubject: "Quick thought about {{business_name}}||{{business_domain}}||noticed this",
    templateBody: `Hey {{first_name}},

I came across {{business_name}} and spent a few minutes on your site. {{opening_line}}

I'm Travis with BlackRidge Platforms. We build custom websites with the full backend portal that runs behind them. Member login, CRM, billing, scheduling, all running from one central place instead of five different tools.

I'd put together a quick mock-up so you can see what a refreshed {{business_name}} could look like. No pitch deck. No pressure. Just want you to see what we see.

Mind if I send it over?

Thanks,
${TRAVIS_SIGNATURE}`,
  },
  {
    stepNumber: 2,
    delayDays: 3,
    templateSubject: "re: quick question||following up||{{business_domain}}",
    templateBody: `Hey {{first_name}},

Sent you a note a couple days ago, just wanted to make sure it didn't get buried.

The thing most owners don't realize is what a slow or hard-to-navigate site is actually costing them every month. The visitors who bounce never tell you why.

Worth a 10-minute look to see what we could change for {{business_name}}? No pressure either way.

${TRAVIS_SIGNATURE}`,
  },
  {
    stepNumber: 3,
    delayDays: 7,
    templateSubject: "one question for you||what would the site do||quick mockup",
    templateBody: `Hey {{first_name}},

Quick question. What's the one thing you wish your website could do for {{business_name}} that it doesn't do today?

If there's a clear answer, that's almost always the same thing we end up building first. I can mock up what that looks like on a redesigned site so you can see it before we ever talk price.

Want me to put it together?

${TRAVIS_SIGNATURE}`,
  },
  {
    stepNumber: 4,
    delayDays: 14,
    templateSubject: "not a $10k project||what it actually costs||honest question",
    templateBody: `Hey {{first_name}},

Most owners assume a full site rebuild is going to cost a fortune. For most of our clients it lands between $1,500 and $3,500 depending on scope, and the build usually pays for itself on a customer or two.

Is cost what's holding this up, or is it just bad timing? Either way, no pressure.

${TRAVIS_SIGNATURE}`,
  },
  {
    stepNumber: 5,
    delayDays: 21,
    templateSubject: "closing the loop||last note||stepping back",
    templateBody: `Hey {{first_name}},

I've reached out a few times and haven't heard back, so I'll assume the timing isn't right. I won't follow up again after this.

If you ever want a second set of eyes on {{business_name}}'s site you know where to find me. Wishing you a strong rest of the year.

${TRAVIS_SIGNATURE}`,
  },
];

export async function seedCampaignA() {
  const existing = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.name, CAMPAIGN_A_NAME))
    .limit(1);

  if (existing.length > 0) {
    const campaign = existing[0];
    const existingSteps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaign.id));

    for (const stepDef of STEPS) {
      const found = existingSteps.find(s => s.stepNumber === stepDef.stepNumber);
      if (found) {
        await db
          .update(campaignSteps)
          .set({
            delayDays: stepDef.delayDays,
            templateSubject: stepDef.templateSubject,
            templateBody: stepDef.templateBody,
          })
          .where(and(eq(campaignSteps.campaignId, campaign.id), eq(campaignSteps.stepNumber, stepDef.stepNumber)));
      } else {
        await db.insert(campaignSteps).values({
          campaignId: campaign.id,
          ...stepDef,
        });
      }
    }

    console.log(`Campaign A updated to ${STEPS.length} steps`);
    return campaign;
  }

  const [campaign] = await db
    .insert(outreachCampaigns)
    .values({ name: CAMPAIGN_A_NAME, isActive: true })
    .returning();

  for (const step of STEPS) {
    await db.insert(campaignSteps).values({
      campaignId: campaign.id,
      ...step,
    });
  }

  console.log(`Seeded Campaign A with ${STEPS.length} steps (id: ${campaign.id})`);
  return campaign;
}
