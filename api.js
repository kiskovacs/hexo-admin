var path = require('path')
var fs = require('fs')
var bunyan = require('bunyan');
var ringbuffer = new bunyan.RingBuffer({ limit: 10 });
var updateAny = require('./update')
  , updatePage = updateAny.bind(null, 'Page')
  , update = updateAny.bind(null, 'Post')
  , deploy = require('./deploy')

module.exports = function (app, hexo) {
  
  function createLogger(){
    var logger = bunyan.createLogger({
      name: 'hexo',
      streams: [{
          level: 'info',
          type: 'raw',    // use 'raw' to get raw log record objects 
          stream: ringbuffer
      }],
      serializers: {
        err: bunyan.stdSerializers.err
      }
    });
  
    // Alias for logger levels
    logger.d = logger.debug;
    logger.i = logger.info;
    logger.w = logger.warn;
    logger.e = logger.error;
    logger.log = logger.info;
  
    return logger;
  }
  
  var logger = hexo.log = createLogger();

  function addIsDraft(post) {
    post.isDraft = post.source.indexOf('_draft') === 0
    post.isDiscarded = post.source.indexOf('_discarded') === 0
    return post
  }

  function tagsAndCategories() {
    var cats = {}
      , tags = {}
    hexo.model('Category').forEach(function (cat) {
      cats[cat._id] = cat.name
    })
    hexo.model('Tag').forEach(function (tag) {
      tags[tag._id] = tag.name
    })
    return {
      categories: cats,
      tags: tags
    }
  }

  function remove(id, body, res) {
    var post = hexo.model('Post').get(id)
    if (!post) return res.send(404, "Post not found")
    var newSource = '_discarded/' + post.source.slice('_drafts/'.length)
    update(id, {source: newSource}, function (err, post) {
      if (err) {
        return res.send(400, err);
      }
      res.done(addIsDraft(post))
    }, hexo)
  }

  function publish(id, body, res) {
    var post = hexo.model('Post').get(id)
    if (!post) return res.send(404, "Post not found")
    var newSource = '_posts/' + post.source.slice('_drafts/'.length)
    update(id, {source: newSource}, function (err, post) {
      if (err) {
        return res.send(400, err);
      }
      res.done(addIsDraft(post))
    }, hexo)
  }

  function unpublish(id, body, res) {
    var post = hexo.model('Post').get(id)
    if (!post) return res.send(404, "Post not found")
    var newSource = '_drafts/' + post.source.slice('_posts/'.length)
    update(id, {source: newSource}, function (err, post) {
      if (err) {
        return res.send(400, err);
      }
      res.done(addIsDraft(post))
    }, hexo)
  }

  var use = function (path, fn) {
    app.use(hexo.config.root + 'admin/api/' + path, function (req, res) {
      var done = function (val) {
        if (!val) {
          res.statusCode = 204
          return res.end('');
        }
        res.setHeader('Content-type', 'application/json')
        res.end(JSON.stringify(val, function(k, v) {
          // tags and cats have posts reference resulting in circular json..
          if ( k == 'tags' || k == 'categories' ) {
            // convert object to simple array
            return v.toArray ? v.toArray().map(function(obj) {
              return obj.name
            }) : v
          }
          return v;
        }))
      }
      res.done = done
      res.send = function (num, data) {
        res.statusCode = num
        res.end(data)
      }
      fn(req, res)
    })
  }

  use('tags-and-categories', function (req, res) {
    res.done(tagsAndCategories())
  });

  use('pages/list', function (req, res) {
   var page = hexo.model('Page')
   res.done(page.toArray().map(addIsDraft));
  });

  use('pages/new', function (req, res, next) {
    if (req.method !== 'POST') return next()
    if (!req.body) {
      return res.send(400, 'No page body given');
    }
    if (!req.body.title) {
      return res.send(400, 'No title given');
    }

    hexo.post.create({title: req.body.title, layout: 'page', date: new Date()})
    .error(function(err) {
      logger.error(err, err.stack)
      return res.send(500, 'Failed to create page')
    })
    .then(function (err, file) {
      var source = file.path.slice(hexo.source_dir.length)
      hexo.source.process([source]).then(function () {
        var page = hexo.model('Page').findOne({source: source})
        res.done(addIsDraft(page));
      });
    });
  });


  use('pages/', function (req, res, next) {
    var url = req.url
    logger.log('in pages', url)
    if (url[url.length - 1] === '/') {
      url = url.slice(0, -1)
    }
    var parts = url.split('/')
    var last = parts[parts.length-1]
    // not currently used?
    if (last === 'remove') {
      return remove(parts[parts.length-2], req.body, res)
    }

    var id = last
    if (id === 'pages' || !id) return next()
    if (req.method === 'GET') {
      var page = hexo.model('Page').get(id)
      if (!page) return next()
      return res.done(addIsDraft(page))
    }

    if (!req.body) {
      return res.send(400, 'No page body given');
    }

    updatePage(id, req.body, function (err, page) {
      if (err) {
        return res.send(400, err);
      }
      res.done({
        page: addIsDraft(page),
        tagsAndCategories: tagsAndCategories()
      })
    }, hexo);
  });

  use('posts/list', function (req, res) {
   var post = hexo.model('Post')
   res.done(post.toArray().map(addIsDraft));
  });

  use('posts/new', function (req, res, next) {
    if (req.method !== 'POST') return next()
    if (!req.body) {
      return res.send(400, 'No post body given');
    }
    if (!req.body.title) {
      return res.send(400, 'No title given');
    }

    hexo.post.create({title: req.body.title, layout: 'draft', date: new Date()})
    .error(function(err) {
      logger.error(err, err.stack)
      return res.send(500, 'Failed to create post')
    })
    .then(function (file) {
      var source = file.path.slice(hexo.source_dir.length)
      hexo.source.process([source]).then(function () {
        var post = hexo.model('Post').findOne({source: source})
        res.done(addIsDraft(post));
      });
    });
  });

  use('posts/', function (req, res, next) {
    var url = req.url
    if (url[url.length - 1] === '/') {
      url = url.slice(0, -1)
    }
    var parts = url.split('/')
    var last = parts[parts.length-1]
    if (last === 'publish') {
      return publish(parts[parts.length-2], req.body, res)
    }
    if (last === 'unpublish') {
      return unpublish(parts[parts.length-2], req.body, res)
    }
    if (last === 'remove') {
      return remove(parts[parts.length-2], req.body, res)
    }

    var id = last
    if (id === 'posts' || !id) return next()
    if (req.method === 'GET') {
      var post = hexo.model('Post').get(id)
      if (!post) return next()
      return res.done(addIsDraft(post))
    }

    if (!req.body) {
      return res.send(400, 'No post body given');
    }

    update(id, req.body, function (err, post) {
      if (err) {
        return res.send(400, err);
      }
      res.done({
        post: addIsDraft(post),
        tagsAndCategories: tagsAndCategories()
      })
    }, hexo);
  });

  use('images/upload', function (req, res, next) {
    if (req.method !== 'POST') return next()
    if (!req.body) {
      return res.send(400, 'No post body given');
    }
    if (!req.body.data) {
      return res.send(400, 'No data given');
    }
    var i = 0
    while (fs.existsSync(hexo.source_dir + 'images/pasted-' + i + '.png')) {
      i +=1
    }
    var filename = 'images/pasted-' + i + '.png'
    var outpath = hexo.source_dir + filename

    var dataURI = req.body.data.slice('data:image/png;base64,'.length)
    var buf = new Buffer(dataURI, 'base64')
    fs.writeFile(outpath, buf, function (err) {
      if (err) {
        logger.log(err)
      }
      hexo.source.process([filename]).then(function () {
        res.done('/' + filename)
      });
    })
  });

  var deploy_in_progress = false;
  use('deploy', function(req, res, next) {
    if (req.method === 'POST' && !deploy_in_progress) try {
      deploy_in_progress = true;
      hexo.call('generate', {deploy:true}).then( function() {
        logger.log('Deploy finished');
        deploy_in_progress = false;
        res.done({stdout: 'Done', stderr: 'No errors'});
      });
    } catch (e) {
      logger.log('Deploy failed:', e);
      deploy_in_progress = false;
      res.done({error: e.message})
    }
  });

  use('log', function(req, res, next) {
    res.done({records: ringbuffer.records});
  });
}
