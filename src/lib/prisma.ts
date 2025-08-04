// place files you want to import through the `$lib` alias in this folder.
import { PrismaClient } from '@prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate'
import { building } from '$app/environment'

let prisma: any = null

if (!building) {
  try {
    prisma = new PrismaClient().$extends(withAccelerate());
  } catch (error) {
    console.warn('Prisma client initialization failed:', error)
    prisma = null
  }
}

export default prisma