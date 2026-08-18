import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { applySignIn } from '@/lib/sign-in';

const isTestMode = process.env.AUTH_TEST_MODE === 'true';

const providers: NextAuthOptions['providers'] = [];

if (isTestMode) {
  providers.push(
    CredentialsProvider({
      name: 'Test Account',
      credentials: {
        name: { label: 'Name', type: 'text', placeholder: 'Test User' },
        email: { label: 'Email', type: 'email', placeholder: 'test@example.com' },
      },
      async authorize(credentials) {
        const email = credentials?.email || 'test@example.com';
        const name = credentials?.name || 'Test User';

        const { allowed, user } = await applySignIn({ email, name });
        if (!allowed || !user) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    })
  );
} else {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      // Test mode already went through applySignIn inside authorize().
      if (isTestMode) return true;

      const { allowed } = await applySignIn({
        email: user.email,
        name: user.name || 'Unknown',
        image: user.image,
      });

      return allowed;
    },
    async jwt({ token, user }: { token: Record<string, unknown>; user?: { id?: string } }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session }) {
      if (session.user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email },
        });
        if (dbUser) {
          (session.user as Record<string, unknown>).id = dbUser.id;
          (session.user as Record<string, unknown>).role = dbUser.role;
          (session.user as Record<string, unknown>).status = dbUser.status;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
