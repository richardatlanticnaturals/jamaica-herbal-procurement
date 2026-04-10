import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Admin login
        if (
          credentials?.email === "jamaicanherbal@gmail.com" &&
          credentials?.password === "jamaica2024"
        ) {
          return {
            id: "1",
            name: "Jamaica Herbal",
            email: "jamaicanherbal@gmail.com",
          };
        }
        // Employee login
        if (
          credentials?.email === "hello@jamaicaherbal.com" &&
          credentials?.password === "jamaica4273"
        ) {
          return {
            id: "2",
            name: "Jamaica Herbal Employee",
            email: "hello@jamaicaherbal.com",
          };
        }
        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
};
