import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { verifyDjangoCredentials } from "@/lib/portal/credentials";
import { mirrorDjangoUser } from "@/lib/portal/mirror";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const identifier = String(creds?.email ?? "").trim();
        const password = String(creds?.password ?? "");
        if (!identifier || !password) return null;

        // Single source of truth for credentials is Django.
        const djangoUser = await verifyDjangoCredentials(identifier, password);
        if (!djangoUser) return null;

        // Mirror into the local Prisma user so Builds (FK'd by user id) keeps working.
        const user = await mirrorDjangoUser(djangoUser);
        if (!user) return null;

        return { id: user.id, name: user.name, email: user.email, image: user.image, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: "ADMIN" | "MEMBER" }).role;
        token.image = user.image ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { id: true, name: true, email: true, image: true, role: true },
        });
        if (user) {
          session.user.id = user.id;
          session.user.name = user.name;
          session.user.email = user.email;
          session.user.image = user.image ?? null;
          session.user.role = user.role;
        } else {
          session.user.id = token.id as string;
          session.user.role = token.role as "ADMIN" | "MEMBER";
          session.user.image = (token.image as string | null | undefined) ?? null;
        }
      }
      return session;
    },
  },
});
