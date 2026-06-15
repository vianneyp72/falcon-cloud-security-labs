FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
RUN npm install --production
EXPOSE 3000
CMD ["node", "server.js"]
