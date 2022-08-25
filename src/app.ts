/*
Usage

Start: 
npm run start
Go to http://localhost:3001/authentication -> redirect to sign page from server -> authorize -> Strategy
*/

import express, { Express } from "express";
import cors from "cors";
import expressSession from "express-session";
import { Issuer, Strategy, TokenSet } from "openid-client";
import passport from "passport";
import { create as createRootCas } from "ssl-root-cas";
import OpenIDConnectStrategy from "passport-openidconnect";

const local = true;
let autoIssuerUrl;
let clientId;
let clientSecret;
let rejectNewUsers;
if (local) {
  autoIssuerUrl = "http://localhost:5770/.well-known/openid-configuration";
  clientId = "oidcCLIENT";
  clientSecret = "verysecret";
  rejectNewUsers = false;
} else {
  autoIssuerUrl = "";
  clientId = "KILi";
  clientSecret = "";
  rejectNewUsers = false;
}

const rootCas = createRootCas();
rootCas.addFile("./ssl/rca.pem");

export const IS_USING_OPENID_CONNECT = !!autoIssuerUrl;

export const fullPath = (route: string) => `${route}`;

export enum AuthRoute {
  AuthenticationStart = "/authentication",
  AuthenticationCallback = "/authentication/callback",
  LogOutStart = "/logout",
  LogOutCallback = "/logout/callback",
  SignIn = "/signin",
}
export enum AuthRoute2 {
  AuthenticationStart = "/authentication2",
  AuthenticationCallback = "/authentication2/callback",
  LogOutStart = "/logout",
  LogOutCallback = "/logout/callback",
  SignIn = "/signin",
}

const redirectURI = `http://localhost:3001${AuthRoute.AuthenticationCallback}`;
const redirectURI2 = `http://localhost:3001${AuthRoute2.AuthenticationCallback}`;

const getFrontendEndpoint = () => "http://localhost:3000";

async function init() {
  const app = express();
  const port = 3001;

  app.listen(port, () => {
    return console.log(`Express is listening at http://localhost:${port}`);
  });

  app.use(
    expressSession({
      cookie: {
        maxAge: 15 * 60 * 1000, // 15 minutes
      },
      resave: false,
      saveUninitialized: true,
      // secret: process.env.DATABASE__SESSION_SECRET ?? "",
      secret: "xxx",
    })
  );

  await openIdConnectStrategy(app);
}

const openIdConnectStrategy = async (app: Express) => {
  if (!IS_USING_OPENID_CONNECT) {
    return;
  }
  try {
    const issuer = await Issuer.discover(autoIssuerUrl);
    console.log(`To authenticate, go to http://localhost:3001/authentication`);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectURI],
      // response_types: ['code'],
      token_endpoint_auth_method: clientSecret ? "client_secret_post" : "none",
    });

    app.use(passport.initialize());
    app.use(passport.session());

    passport.use(
      "oidc",
      new Strategy(
        { client },
        async (tokenSet: TokenSet, userInfo: any, done: any) => {
          console.log("USE STRAT");
          const claims = tokenSet.claims();
          console.log("use strategry oidc", {
            claims,
            rejectNewUsers,
            tokenSet,
            userInfo,
          });
          if (!rejectNewUsers) {
            const scopes = (tokenSet.scope ?? "").split(" ");
            const isEmailInScope = scopes.includes("email");
            if (isEmailInScope) {
              const email = userInfo.email;
              console.log("Email in scope and got email", { email });
              // signUpUserIfNotExists(models, email).then((_) => {
              const claims = tokenSet.claims();
              const fullObject = {
                ...userInfo,
                ...claims,
              };
              return done(null, fullObject);
              // });
            }
            const { access_token, token_type } = tokenSet;
            console.log({ access_token, token_type });
            if (access_token) {
              client
                .userinfo(access_token, {
                  method: "POST",
                  params: { email: null },
                  tokenType: token_type,
                  via: "header",
                })
                .then((userInfoResponse) => {
                  const email = userInfoResponse.email;
                  console.log({ email, userInfoResponse });
                  if (email) {
                    const fullObject = {
                      ...userInfoResponse,
                    };
                    return done(null, fullObject);
                  }
                  return done(null, tokenSet.claims());
                })
                .catch((error) => console.error(error));
            }
          } else {
            console.log("reject new users");
            return done(null, tokenSet.claims());
          }
        }
      )
    );

    passport.serializeUser((user: any, done: any) => {
      console.log("searialize", { user });
      done(null, user);
    });

    passport.deserializeUser((user: any, done: any) => {
      console.log("desearialize", { user });
      done(null, user);
    });

    app.get(fullPath(AuthRoute.AuthenticationStart), (req, res, next) => {
      // const scope = (issuer.metadata?.scopes_supported as string[]).join(' ') ?? 'openid email';
      console.log("START");
      const scope = "openid";
      // const scope = "openid";
      console.log({ scope });
      passport.authenticate("oidc", { scope })(req, res, next);
    });

    app.get(fullPath(AuthRoute.AuthenticationCallback), (req, res, next) => {
      console.log("CALLBACK");
      passport.authenticate("oidc", {
        failureRedirect: getFrontendEndpoint(),
        scope: "openid",
        successRedirect: `${getFrontendEndpoint()}/label/login/success`,
      })(req, res, next);
    });

    const corsOptions = {
      credentials: true,
      origin: true,
    };

    app.get(fullPath(AuthRoute.SignIn), cors(corsOptions), async (req, res) => {
      // @ts-ignore
      if (!req.isAuthenticated()) {
        res.redirect(getFrontendEndpoint());
      }
      // @ts-ignore
      const email = req.user?.email as string;
      // @ts-ignore
      console.log("USE SIGNIN", req.user);
      const user = await findByEmail(email);
      if (!user && rejectNewUsers) {
        return res.sendStatus(403);
      }
      const payload = {
        id: user.id,
        token: await createToken(user, "4w"),
        user,
      };
      return res.json(payload);
    });

    app.get(fullPath(AuthRoute.LogOutStart), (_, res) => {
      res.redirect(client.endSessionUrl());
    });

    app.get(fullPath(AuthRoute.LogOutCallback), (req, res) => {
      // @ts-ignore
      req.logout();
      res.redirect(getFrontendEndpoint());
    });

    passport.use(
      new OpenIDConnectStrategy(
        {
          issuer: "https://identityrec.devinfo.fr.cly/outil/SOID/",
          authorizationURL:
            "https://identityrec.devinfo.fr.cly/outil/SOID/openid/authorize",
          tokenURL:
            "https://identityrec.devinfo.fr.cly/outil/SOID/openid/token",
          userInfoURL:
            "https://identityrec.devinfo.fr.cly/outil/SOID/openid/userinfo",
          clientID: clientId,
          clientSecret: clientSecret,
          callbackURL: redirectURI2,
        },
        function verify(issuer, profile, cb) {
          const user = { email: "test+admin@kili-technology.com" };
          return cb(null, user);
        }
      )
    );

    app.get(
      fullPath(AuthRoute2.AuthenticationStart),
      passport.authenticate("openidconnect")
    );
    app.get(
      fullPath(AuthRoute2.AuthenticationCallback),
      passport.authenticate("openidconnect", {
        failureRedirect: "/login",
        failureMessage: true,
      }),
      function (req, res) {
        res.redirect("/");
      }
    );
  } catch (error) {
    console.error("OpenId - failed to initialize connection with IDP");
    console.error(error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
    throw error;
  }
};

const createToken = async (user, way) => {
  return "xxx";
};

const findByEmail = async (email) => {
  console.log("find by email");
  return {
    id: "xxx",
  };
};

init();