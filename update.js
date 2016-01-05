var fs = require('fs'),
  path = require('path'),
  moment = require('moment'),
  dbox = require('dbox'),
  hfm = require('hexo-front-matter'),
  file = require('hexo-fs'),
  extend = require('extend');
//  yfm = util.yfm,
//  escape = util.escape;

/**
 * Updates a post.
 *
 * @method update
 * @param {str} model the type of model being updated
 * @param {Object} post a post model
 * @param {Object} update attributes to update
 * @param {Function} callback
 */
module.exports = function (model, id, update, callback, hexo) {
  var post = hexo.model(model).get(id)
  if (!post) {
    return callback('Post not found');
  }
  
  var logger = hexo.log;
  
  var config = hexo.config,
    slug = post.slug = hfm.escape(post.slug || post.title, config.filename_case),
    layout = post.layout = (post.layout || config.default_layout).toLowerCase(),
    date = post.date = post.date ? moment(post.date) : moment();
    
  var dbox_client = config.dropbox_migrator? dbox.app({
      "app_key": config.dropbox_migrator.app_key,
      "app_secret": config.dropbox_migrator.app_secret,
      "root": "dropbox"}
  ).client({
      "oauth_token_secret": config.dropbox_migrator.oauth_token_secret,
      "oauth_token": config.dropbox_migrator.oauth_token,
      "uid": config.dropbox_migrator.userid
      }): null;
  
  var split = hfm.split(post.raw),
    frontMatter = split.data
    compiled = hfm.parse([frontMatter, '---', split.content].join('\n'));

  var preservedKeys = ['title', 'date', 'tags', 'categories', '_content'];
  var prev_full = post.full_source,
    full_source = prev_full;
  if (update.source && update.source !== post.source) {
    // post.full_source only readable ~ see: /hexo/lib/models/post.js
    full_source = hexo.source_dir + update.source
  }

  preservedKeys.forEach(function (attr) {
    if (attr in update) {
      compiled[attr] = update[attr]
    }
  });
  compiled.date = moment(compiled.date).toDate()

  delete update._content

  var raw = hfm.stringify(compiled)
    .replace(/title: ([^"\n]+)/,'title: "$1"')
    .replace(/- ([^"\n]+)/g,'- "$1"')
    ;
  update.raw = raw
  update.updated = moment()

  // tags and cats are only getters now. ~ see: /hexo/lib/models/post.js
  if ( typeof update.tags !== 'undefined' ) {
    post.setTags(update.tags)
    delete update.tags
  }
  if ( typeof update.categories !== 'undefined' ) {
    post.setCategories(update.categories)
    delete update.categories
  }

  extend(post, update)

  post.save(function () {
    if (dbox_client){
      var dbox_source = config.dropbox_migrator.source_dir +
       (config.source_dir[config.source_dir.length-1] === '/' ? '' : '/') + 
          post.source;
      logger.info("Writing to dropbox:", dbox_source);
      dbox_client.put(dbox_source, raw, function(status, replay){
        if (status == 200){
          logger.info("Dropbox write success:", replay);
        } else {
          logger.error("Dropbox returned status:", status, replay);
        }
      })
    }
    
    file.writeFile(full_source, raw, function(err){
      if (err) return callback(err);
      logger.log("Saved:",post.full_source, post.source)  
      if (full_source !== prev_full) {
        fs.unlinkSync(prev_full)
      }
      hexo.source.process([post.source]).then(function () {
        logger.log("Processed:",post.full_source, post.source)
        callback(null, hexo.model(model).get(id));
      });
    });
  });
}
