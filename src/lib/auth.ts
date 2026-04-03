import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';

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

        const user = await prisma.user.upsert({
          where: { email },
          update: { name },
          create: { email, name },
        });

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

      if (!isTestMode) {
        await prisma.user.upsert({
          where: { email: user.email },
          update: {
            name: user.name || 'Unknown',
            image: user.image,
          },
          create: {
            email: user.email,
            name: user.name || 'Unknown',
            image: user.image,
          },
        });
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email },
        });
        if (dbUser) {
          (session.user as any).id = dbUser.id;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
