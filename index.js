"use latest";

const express = require("express");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const csurf = require("csurf");
const moment = require("moment");
const jwt = require("jsonwebtoken");
const ejs = require("ejs");
const _ = require("lodash");

const PORT = process.env.PORT || 5000;

const app = express();

app.use(
  cookieSession({
    name: "session",
    secret: "shhh...",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  })
);

const csrfProtection = csurf();

app.get("/", verifyInputToken, csrfProtection, (req, res) => {
  // get required fields from JWT passed from Auth0 rule
  const requiredFields =
    req.tokenPayload[`${process.env.TOKEN_ISSUER}/claims/required_fields`];
  // store data in session that needs to survive the POST
  req.session.subject = req.tokenPayload.sub;
  req.session.requiredFields = requiredFields;
  req.session.state = req.query.state;

  // render the profile form
  const data = {
    subject: req.tokenPayload.sub,
    csrfToken: req.csrfToken(),
    fields: {},
    action: req.originalUrl.split("?")[0],
  };
  requiredFields.forEach((field) => {
    data.fields[field] = {};
  });

  const html = renderProfileView(data);

  res.set("Content-Type", "text/html");
  res.status(200).send(html);
});

const parseBody = bodyParser.urlencoded({ extended: false });

app.post("/", parseBody, csrfProtection, validateForm, (req, res) => {
  if (req.invalidFields.length > 0) {
    // render the profile form again, showing validation errors
    const data = {
      subject: req.session.subject,
      csrfToken: req.csrfToken(),
      fields: {},
      action: "",
    };
    req.session.requiredFields.forEach((field) => {
      data.fields[field] = {
        value: req.body[field],
        invalid: req.invalidFields.includes(field),
      };
    });

    const html = renderProfileView(data);

    res.set("Content-Type", "text/html");
    return res.status(200).send(html);
  }

  // render form that auth-posts back to Auth0 with collected data
  const formData = _.omit(req.body, "_csrf");
  const HTML = renderReturnView({
    action: `https://${process.env.AUTH0_DOMAIN}/continue?state=${req.session.state}`,
    formData,
  });

  // clear session
  req.session = null;

  res.set("Content-Type", "text/html");
  res.status(200).send(HTML);
});

// module.exports = fromExpress(app);

app.listen(PORT, () => console.log(`Listening on ${PORT}`));

// middleware functions

function verifyInputToken(req, res, next) {
  const options = {
    issuer: process.env.TOKEN_ISSUER,
    audience: process.env.TOKEN_AUDIENCE,
  };

  try {
    req.tokenPayload = jwt.verify(
      req.query.token,
      process.env.TOKEN_SECRET,
      options
    );
  } catch (err) {
    return next(err);
  }
  return next();
}

function validateForm(req, res, next) {
  const requiredFields = req.session.requiredFields;

  const validation = {
    title: (value) => value && value.trim().length > 0,
    company: (value) => value && value.trim().length > 0,
    email_opt_in: (value) => value && ["yes", "no"].indexOf(value) >= 0,
  };

  req.invalidFields = [];
  requiredFields.forEach((field) => {
    if (!validation[field](req.body[field])) {
      req.invalidFields.push(field);
    }
  });

  next();
}

// view functions

function renderProfileView(data) {
  const template = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>User Profile</title>
      <link rel="stylesheet" href="//maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css" integrity="sha384-BVYiiSIFeK1dGmJRAkycuHAHRg32OmUcww7on3RYdg4Va+PmSTsz/K68vbdEjh4u" crossorigin="anonymous">
    </head>

    <body>
      <div class="jumbotron">
        <div class="container">
          <div class="row" style="padding-top: 20px;">
            <div class="col-md-6 col-sm-offset-2">
              <p class="lead">Hello <strong><%= subject %></strong>, we just need a couple more things from you to complete your profile:</p>
            </div>
          </div>
          
          <form class="form-horizontal" method="post" action="<%= action %>" id="extra-fields-form">
            <input type="hidden" name="_csrf" value="<%= csrfToken %>">
          
            <% if (fields.title) { %>
            <div class="form-group<% if (fields.title.invalid) { %> has-error<% } %>">
              <label for="title" class="col-sm-2 control-label">Title:</label>
              <div class="col-sm-4">
                <input type="text" class="form-control" id="title" name="title" placeholder="Developer" value="<%= fields.title.value %>">
              </div>
            </div>
            <% } %>
    
            <% if (fields.company) { %>
            <div class="form-group<% if (fields.company.invalid) { %> has-error<% } %>">
            <label for="company" class="col-sm-2 control-label">Company:</label>
              <div class="col-sm-4">
                <input type="text" class="form-control" id="company" name="company" placeholder="Appsembler" value="<%= fields.company.value %>">
              </div>
            </div>
            <% } %>
            
            <% if (fields.email_opt_in) { %>
            <div class="form-group<% if (fields.email_opt_in.invalid) { %> has-error<% } %>">
            <label for="email_opt_in" class="col-sm-2 control-label">Email Opt In</label>
              <div class="col-sm-4">
                <select id="email_opt_in" name="email_opt_in" form="extra-fields-form">
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
            <% } %>
            
            <div class="form-group">
              <div class="col-sm-offset-2 col-sm-10">
                <button type="submit" class="btn btn-default">Submit</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </body>
    </html>
  `;

  return ejs.render(template, data);
}

function renderReturnView(data) {
  const template = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
    </head>

    <body>
      <form id="return_form" method="post" action="<%= action %>">
        <% Object.keys(formData).forEach((key) => { %>
        <input type="hidden" name="<%= key %>" value="<%= formData[key] %>">
        <% }); %>
      </form>
      <script>
        // automatically post the above form
        var form = document.getElementById('return_form');
        form.submit();
      </script>
    </body>
    </html>
  `;

  return ejs.render(template, data);
}

module.exports = {
  app,
};
