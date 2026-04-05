import { type InsertContact, type CreateLead, type UpdateLead, type ContactSubmission, contactSubmissions } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  createContactSubmission(contact: InsertContact): Promise<ContactSubmission>;
  createLead(lead: CreateLead): Promise<ContactSubmission>;
  getContactSubmissions(): Promise<ContactSubmission[]>;
  getContactSubmission(id: string): Promise<ContactSubmission | undefined>;
  updateContactSubmission(id: string, data: UpdateLead): Promise<ContactSubmission | undefined>;
  deleteContactSubmission(id: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async createContactSubmission(contact: InsertContact): Promise<ContactSubmission> {
    const [submission] = await db.insert(contactSubmissions).values(contact).returning();
    return submission;
  }

  async createLead(lead: CreateLead): Promise<ContactSubmission> {
    const values: any = {
      name: lead.name,
      email: lead.email,
      company: lead.company || null,
      projectType: lead.projectType || null,
      budget: lead.budget || null,
      message: lead.message,
      status: lead.status || "new",
      priority: lead.priority || "medium",
      projectedValue: lead.projectedValue ?? null,
      closeProbability: lead.closeProbability ?? null,
      leadSource: lead.leadSource || null,
      followUpDate: lead.followUpDate ? new Date(lead.followUpDate) : null,
    };
    const [submission] = await db.insert(contactSubmissions).values(values).returning();
    return submission;
  }

  async getContactSubmissions(): Promise<ContactSubmission[]> {
    return db.select().from(contactSubmissions).orderBy(desc(contactSubmissions.createdAt));
  }

  async getContactSubmission(id: string): Promise<ContactSubmission | undefined> {
    const [submission] = await db.select().from(contactSubmissions).where(eq(contactSubmissions.id, id));
    return submission;
  }

  async updateContactSubmission(id: string, data: UpdateLead): Promise<ContactSubmission | undefined> {
    const updateValues: any = { ...data, updatedAt: new Date() };
    if (data.followUpDate !== undefined) {
      updateValues.followUpDate = data.followUpDate ? new Date(data.followUpDate) : null;
    }
    if (data.lastContactedAt !== undefined) {
      updateValues.lastContactedAt = data.lastContactedAt ? new Date(data.lastContactedAt) : null;
    }
    const [updated] = await db
      .update(contactSubmissions)
      .set(updateValues)
      .where(eq(contactSubmissions.id, id))
      .returning();
    return updated;
  }

  async deleteContactSubmission(id: string): Promise<boolean> {
    const result = await db.delete(contactSubmissions).where(eq(contactSubmissions.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
