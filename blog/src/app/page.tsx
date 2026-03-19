import { getAllPosts } from "@/lib/posts";
import PostList from "@/components/post-list";

export default function Home() {
  const posts = getAllPosts();
  return <PostList posts={posts} />;
}
