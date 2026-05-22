import { Type, type Static } from "@sinclair/typebox";

export const TodoStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
]);

export const TodoItemSchema = Type.Object({
  content: Type.String({ minLength: 1, description: "Imperative description of the task" }),
  status: TodoStatusSchema,
  activeForm: Type.String({ minLength: 1, description: "Present continuous form shown while executing" }),
});

export const TodoListSchema = Type.Array(TodoItemSchema);

export type TodoStatus = Static<typeof TodoStatusSchema>;
export type TodoItem = Static<typeof TodoItemSchema>;
export type TodoList = Static<typeof TodoListSchema>;
