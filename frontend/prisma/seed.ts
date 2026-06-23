import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPass = await bcrypt.hash("admin123", 10);
  const memberPass = await bcrypt.hash("member123", 10);

  const clare = await prisma.user.upsert({
    where: { email: "clare@calarisolutions.com" },
    update: {},
    create: { name: "Clare", email: "clare@calarisolutions.com", role: "ADMIN", passwordHash: adminPass },
  });

  const member = await prisma.user.upsert({
    where: { email: "member@calarisolutions.com" },
    update: {},
    create: { name: "Team Member", email: "member@calarisolutions.com", role: "MEMBER", passwordHash: memberPass },
  });

  const client = await prisma.client.create({
    data: { name: "Acme Dental", company: "Acme Dental Group", email: "ops@acmedental.com" },
  });

  await prisma.build.create({
    data: {
      title: "Acme Dental — Lead intake & booking automation",
      status: "ASSIGNED",
      goals: "Capture website + ad leads, route to booking, follow up automatically.",
      integrations: "GHL, Zapier",
      clientId: client.id,
      creatorId: clare.id,
      assigneeId: member.id,
      contactSources: {
        create: [
          { type: "WEBSITE", label: "Homepage contact form" },
          { type: "ADS", label: "Meta lead ad" },
        ],
      },
      stages: {
        create: [
          { name: "New Lead", order: 1, description: "Contact just entered", needsManual: false },
          { name: "Contacted", order: 2, description: "First outreach sent", needsManual: true,
            manualActions: { create: [{ description: "Rep calls within 1 hour", owner: "Sales" }] } },
          { name: "Booked", order: 3, description: "Appointment scheduled", needsManual: false },
        ],
      },
      tasks: {
        create: [
          { title: "Build GHL intake automation", type: "AUTOMATION", aiGenerated: true, status: "IN_PROGRESS", assigneeId: member.id },
          { title: "Create booking funnel", type: "FUNNEL", aiGenerated: true, status: "TODO", assigneeId: member.id },
          { title: "Website contact form", type: "FORM", aiGenerated: true, status: "TODO", assigneeId: member.id },
        ],
      },
    },
  });

  console.log("Seeded:", { clare: clare.email, member: member.email, client: client.name });
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
