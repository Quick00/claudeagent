FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ARG NEXT_PUBLIC_AUTH_TEST_MODE
ENV NEXT_PUBLIC_AUTH_TEST_MODE=$NEXT_PUBLIC_AUTH_TEST_MODE
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache git openssh-client su-exec curl bash
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN cp -L /root/.local/bin/claude /usr/local/bin/claude

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/docker-entrypoint.sh"]
