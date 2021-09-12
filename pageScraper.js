const mongoose = require('mongoose')
require('dotenv').config()

// mongoose config for MongoDB table
const BlogPost = mongoose.model('BlogPost', {
  url: String,
  title: String,
  date: String,
  content: [
    {
      blockType: String,
      src: String,
      textContent: String,
      listItems: {
        type: [String],
        default: undefined // avoids empty array when listItems is undefined
      }
    }
  ]
})

mongoose.connect(process.env.MONGO_URL)

const scraper = {
  url: 'https://www.calnewport.com/blog',
  async scraper(browser) {
    const totalPages = 8 // page to end at. blog has 123 pages currently
    let currentPage = 1 // page to start from, will increment each time

    // initialize array of posts to eventually return
    const postsJson = []

    while (currentPage <= totalPages) {
      const currentBlogPage = await browser.newPage()

      const currentPageUrl = this.url + `/page/${currentPage}`

      console.log(`Navigating to ${currentPageUrl}...`)
      await currentBlogPage.goto(currentPageUrl)

      await currentBlogPage.waitForSelector('article')

      // get all post urls for the current page
      const postHrefs = await currentBlogPage.evaluate(() => {
        const postAnchors = document.querySelectorAll('article .blogtitle a')

        const hrefs = []
        postAnchors.forEach((anchor) => hrefs.push(anchor.href))

        return hrefs
      })

      // build content for each post
      for (let singlePostUrl of postHrefs) {
        const singlePostPage = await browser.newPage()

        console.log(`\nNavigating to post at ${singlePostUrl}...`)
        await singlePostPage.goto(singlePostUrl)

        await singlePostPage.waitForSelector('article')

        const postJson = await singlePostPage.evaluate((singlePostUrl) => {
          // initialize this shit here because the evaluate function
          // wont see it otherwise (aka i'm a puppeteer noob)
          const buildContent = (articleEl) => {
            const isImage = (element) => element?.innerHTML.startsWith('<img ')
            const getSrc = (element) => element.children[0].src
            const isQuote = (element) => element.tagName === 'BLOCKQUOTE'
            const getQuote = (element) => element.children[0].innerHTML
            const isMoreBlock = (element) =>
              element.children[0]?.id?.includes('more-')
            const isOrderedList = (element) => element.tagName === 'OL'
            const isUnorderedList = (element) => element.tagName === 'UL'
            const getListItems = (element) =>
              Array.from(element.querySelectorAll('li')).map(
                (el) => el.innerHTML
              )

            const buildBlock = (element) => {
              if (isQuote(element))
                return {
                  blockType: 'quote',
                  textContent: getQuote(element)
                }

              if (isOrderedList(element))
                return {
                  blockType: 'ordered-list',
                  listItems: getListItems(element)
                }

              if (isUnorderedList(element))
                return {
                  blockType: 'unordered-list',
                  listItems: getListItems(element)
                }

              if (isImage(element))
                return {
                  blockType: 'image',
                  src: getSrc(element)
                }

              // ignore "more" blocks, they might be a hook for the "read more" thing
              if (isMoreBlock(element)) return null

              // else it's a paragraph for sure!
              return {
                blockType: 'paragraph',
                textContent: element.innerHTML
              }
            }

            const content = Array.from(articleEl.children)
              .map((child) => buildBlock(child))
              .filter(Boolean) // remove unused blocks

            return content
          }

          // prepare a JSON
          const post = {}

          // add the original link
          post.url = singlePostUrl

          // remove comments div
          document.getElementById('comments').remove()

          const postEl = document.querySelector('article')

          // get post title
          post.title = postEl.querySelector('.blogtitle').innerText

          // get date from URL, format "YYYY/MM/DD", which comes after "/blog/"
          const dateStartIndex = singlePostUrl.indexOf('/blog/') + 6
          const dateEndIndex = dateStartIndex + 10
          post.date = singlePostUrl.slice(dateStartIndex, dateEndIndex)

          // remove style, title and date (first 3 children)
          postEl.children[0].remove()
          postEl.children[0].remove()
          postEl.children[0].remove()

          // get article content
          post.content = buildContent(postEl)

          return post
        }, singlePostUrl)

        // console.log('Article JSON: \n', postJson, '\n\n\n')

        // add JSON posts to the overall object
        postsJson.push(postJson)

        // add JSON post to the DB
        const mongoDBPost = new BlogPost(postJson)
        mongoDBPost.save().then(() => console.log('saved to mongo!'))
      }

      console.log(`Page ${currentPage} complete`)

      // increment page!
      currentPage = currentPage + 1
    }

    // const fs = require('fs')
    // fs.writeFile('./articles.json', JSON.stringify(postsJson), (err) =>
    //   err ? console.log(err) : null
    // )

    await browser.close()
  }
}

module.exports = scraper
