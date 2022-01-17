import express from 'express';
import cors from 'cors'
import dotenv from "dotenv-defaults"
import http from "http";
import bodyParser from "body-parser"
import { ApolloServer, gql, AuthenticationError } from 'apollo-server-express'
import { readFileSync } from 'fs';
import jwt from "jsonwebtoken"
import {execute, subscribe} from "graphql"
import { SubscriptionServer } from 'subscriptions-transport-ws'
import { makeExecutableSchema } from '@graphql-tools/schema'
import fileUpload from "express-fileupload"

import mongo from "./mongo"
import db from './models'
import apiRoute from "./routes/index.js"
import resolvers from "./resolvers"
import { PubSub } from 'graphql-subscriptions';

dotenv.config()

const port = process.env.PORT || 4000;
const {SECRET_KEY} = process.env;

(async function () {

  const app = express()
  app.use(cors())
  app.use(bodyParser.json())
  app.use(fileUpload())
  app.use('/api', apiRoute)

  mongo()

  const httpServer = http.createServer(app);

  const typeDefs = readFileSync('./src/schema.graphql').toString('utf-8')
  const schema = makeExecutableSchema({ typeDefs, resolvers })
  const pubsub = new PubSub()

  const subscriptionBuildOptions = async (connectionParams,webSocket) => {                      
    return { db, pubsub }
  } 

  const subscriptionServer = SubscriptionServer.create(
    { 
      schema, 
      execute, 
      subscribe ,
      onConnect: subscriptionBuildOptions
    },
    { server: httpServer, path: '/graphql' }
  );
 

  const server = new ApolloServer({
    schema,
    context: async({req}) => {
      try {
        const token = req.headers.authorization || '';
        const splitToken = token.split(' ')[1]
        if (!splitToken) throw new Error("Token not found")
        const result = jwt.verify(splitToken, SECRET_KEY)
        const {userID} = result
        const user = await db.User.findOne({userID})
        if (user){
            return { db, userID, pubsub };
        }else{
            throw new Error("User not found!")
        }
      } catch (e) {
        console.log(e)
      }
    },
    plugins: [
      {
        async serverWillStart() {
          return {
            async drainServer() {
              subscriptionServer.close()
            }
          }
        }
      }
    ]
  })

  await server.start()
  server.applyMiddleware({ app })

  httpServer.listen(port, () => {
    console.log(`🚀 Server Ready at ${port}! 🚀`);
    console.log(`Graphql Port at ${port}${server.graphqlPath}`);
  });
})()