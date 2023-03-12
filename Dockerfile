FROM node:19-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY ./src/package.json ./src/package-lock.json ./
RUN npm ci --only=production

# Bundle app source
COPY ./src .

EXPOSE 80
CMD [ "node", "index.js" ]
