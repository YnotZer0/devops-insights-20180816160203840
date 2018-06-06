/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var watson = require('watson-developer-cloud');  //load in all watson sdk apis

//var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk

var app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());



// Create the service wrapper
//var conversation = new Conversation({
var conversation = new watson.conversation({
  username: process.env.CONVERSATION_USERNAME,
  password: process.env.CONVERSATION_PASSWORD,
  url: process.env.CONVERSATION_URL,
  version_date: '2016-10-21',
  version: 'v1'
});


//we can probably remove this, it was hang-over from the java source code
app.get('/rest/setup', function(req, res) {
  console.log('wId='+process.env.WORKSPACE_ID);
  return res.json({'WORKSPACE_ID': process.env.WORKSPACE_ID});
})


// Endpoint to be call from the client side

app.post('/api/convmessage', function(req, res) {

  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }

  var payload = {
    workspace_id: workspace,
    context: req.body.context || {}, //we'll need to keep a copy of this to use on subsequent calls
    input: req.body.input || {}
  };

  payload.input.text = payload.input.text.replace(/\n|\t|\r/gi, ' ');
  payload.alternate_intents = true;
  payload.context = payload.context ? payload.context : {};


  conversation.message(payload, function (err, data) {
    if (err) {
      console.log("ERROR-2");
      console.log(err);
      data = {
        'error': err['error'],
        'errors': err['errors']
      };
      return res.status(err.code || 500).json(err);
    }
    //console.log(data); //data contains the response from WA

  //the following should rarely happen, but just incase it does (it can happen if you have a node with no text entry response)
    if (!data.output) {
      data.output = {}; //set the output as an empty json variable
    } else {

// here we can look at the data.intents[x].intent/.confidence to see what the confidence level is
// for example: if <0.5 we can decide to perform a Discovery lookup automatically
// for now, we shall perform the Discovery lookup based on the serviceInstructions having a value

      var serviceInstructions = data.context.actions ? data.context.actions : data.context.serviceInstructions;
//    if (serviceInstructions == 'WDS_SEARCH' || serviceInstructions == 'WDS_QUERY_TEMPLATE' || serviceInstructions == 'WDS_SEARCH_FILTER')) {
      if(serviceInstructions != null) { //we have a value set so perform a WDS NLP query

          callDiscovery(data).then(() => {

            // data object should now contain a new json object (as many docs as returned from Discovery)
            // "DiscoveryPayload":[{"id":"a9f88d83f97f3a19acd26d8db3109b8a","title":"  ","body":"a body","sourceUrl":"(Agreement - with extension works).doc","bodySnippet":"a snippet","confidence":1}]}
//            console.log('discResponse='+JSON.stringify(data));
            //we'll now return the full data object back to be displayed in the UI
            return res.json(data);
          });

      } else {
        //if we did not call Discovery, then we shall just return was was passed back from Watson Assistant
        return res.json(data);
      }
    }
  });
});


function callDiscovery(data) {
  return new Promise(function (resolve, reject) {

    
    var discovery = new watson.DiscoveryV1({
      username: process.env.DISCOVERY_USERNAME,
      password: process.env.DISCOVERY_PASSWORD,
      version: 'v1',
      version_date: process.env.DISCOVERY_VERSION,
      url : process.env.DISCOVERY_URL
    });

    var version_date = discovery.version_date;
    var environment_id = process.env.DISCOVERY_ENV_ID;
    var collection_id = process.env.DISCOVERY_COLL_ID;

    var serviceInstructions = data.context.actions ? data.context.actions : data.context.serviceInstructions;


console.log("Utterance for WDS="+data.input.text);


    discovery.query({
//      https://gateway-fra.watsonplatform.net/discovery/api/v1/environments/fe9a9191-7a82-4403-81d7-2586a56665c4/collections/73aeece1-0e5c-42cf-a4af-ec098cf9409b/query?version=2017-11-07&deduplicate=false&highlight=true&passages=true&passages.count=5&natural_language_query=what%20is%20gdpr
      version_date: version_date,
      environment_id: environment_id,
      collection_id: collection_id,
      deduplicate: false,
      passages: true,  //indicate we want passages
      count: data.context.passage_count ? data.context.passage_count : 3,  //if not set, force just 3 passages being returned
      highlight: true,  //and that we want them highlighted
      aggregation: data.context.query && serviceInstructions == 'WDS_QUERY_TEMPLATE' ? data.context.query : null,
      filter: data.context.filter && (serviceInstructions == 'WDS_SEARCH_FILTER' || serviceInstructions == 'WDS_FILTER') ? data.context.filter : null,      
      natural_language_query: serviceInstructions == 'WDS_SEARCH' || 'WDS_SEARCH_FILTER' ? data.context.wds_search_query? data.context.wds_search_query : data.input.text : null  //data.input.text = original utternace from user      
    },
      (err1, data1) => {
        if (err1) {
          console.log("Error: ");
          console.log(err1);
          resolve();
        } else {
//          console.log('data1='+JSON.stringify(data1));
          //need to loop through the results from Discovery and put into an array of docs to send back to the UI
          
          console.log("number of docs matching our WDS query="+data1.matching_results);

          var docs = [];
          if((data1.matching_results != null) && (data1.matching_results >0)) {
            console.log("we have responses back from WDS");

            for(var i=0; i<data1.matching_results; i++) {
              
              //an example of using .replace to extract out if there is no title or if it is a blank line/tab/etc...
              var title = data1.results[i].extracted_metadata.title.replace(/\n|\t|\r/gi, ' ');
      
              var highlight = "";
              console.log("HIGHLIGHT="+JSON.stringify(data1.results[i].highlight));

              //by default the .highlight puts <em></em> HTML tags around the highlighted sections

//              highlight = data1.results[i].highlight.html ? data1.results[i].highlight.text : " ";
      
              if (data1.results[i].highlight) {
                for (var ind in data1.results[i].highlight.text) {
                  highlight += data1.results[i].highlight.text[ind] + "...\n";
                }
                highlight = highlight.replace(new RegExp("<em>", 'g'), "<hilite>");
                highlight = highlight.replace(new RegExp("</em>", 'g'), "</hilite>");
              } else {
                var textlength = data1.results[i].highlight.text.length < 100 ? data1.results[i].highlight.text.length : 100;
                highlight = data1.results[i].highlight.text.substring(0, textlength);
              }

              
              let filename = data1.results[i].extracted_metadata.filename;
              let name = '';
              if (filename.indexOf('.json') != -1) {
                name = filename.substring(0, filename.indexOf('.json'));
                filename = name + '.json';
              } else if (filename.indexOf('.pdf') != -1) {
                name = filename.substring(0, filename.indexOf('.pdf'))
              } else if (filename.indexOf('.doc') != -1) {
                name = filename.substring(0, filename.indexOf('.doc'))
              }

//              let fulltext = data1.results[i].html || data1.results[i].text;
              //we can set the fulltext to be the .results[0].text field - but this is the whole document
              //if we want to reduce this down, we can just show the passage(s) instead
//              let fulltext = data1.results[i].text.replace(/\n|\t|\r/gi, ' '); //replace dodgy chars with spaces
//              fulltext = fulltext.replace("no title", "");
//              fulltext = fulltext.replace("/**//**/", "");
//              fulltext = fulltext.replace("Page Content", "");

              var numPassages = data1.passages.length;
              console.log("numPassages="+JSON.stringify(numPassages));
              let fulltext = data1.passages[0].passage_text;
//            console.log("passages="+JSON.stringify(data1.passages));
//            console.log("number of passages="+data1.passages.length());
//            console.log("passage1="+data1.passages[0].passage_text);

              //now push the Discovery responses into the array to be rendered in the UI
              docs.push({
                id: data1.results[i].id,
                title: 'a title',
                body: fulltext, //'a body',
                filename: name,
                sourceUrl: data1.results[i].source_url,
                bodySnippet: highlight,
                confidence: data1.results[i].result_metadata.score
              });
            }
          } else {
              //if we get no response back from Discovery (should not really happen), but if it does we cater for it
              docs.push({
                id: 'no id',
                title: 'no results found',
                body: 'empty',
                sourceUrl: 'empty',
                bodySnippet: 'empty',
                confidence: '0.0'
              });
          }

          //show the docs array[] output
//          console.log("docs="+JSON.stringify(docs));
          
          data['DiscoveryPayload'] = docs;
          resolve();
        }
    });
  });
}


module.exports = app;
