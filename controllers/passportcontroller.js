const User=require('./../Models/user');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;


const gclientid=process.env.GOOGLE_CLIENT_ID_LOCAL || "";
const gclientsecret=process.env.GOOGLE_CLIENT_SECRET_LOCAL || "";